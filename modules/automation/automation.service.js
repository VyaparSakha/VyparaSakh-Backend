import Automation from "../../models/automation.model.js";
import Inventory from "../../models/inventory.model.js";
import Sale from "../../models/sale.model.js";
import Store from "../../models/store.model.js";
import { sendMailWithRetry, sendLowStockNotificationEmail } from "../../utils/mailer.js";
import { buildHealthyInventoryEmail, buildSalesSummaryEmail } from "../../templates/emails/emailTemplates.js";
import { scheduledQueue, addAiTask } from "../../queues/aiQueue.js";
import { buildCronExpression, calculateOneTimeDelay } from "../../utils/cronHelper.js";

/**
 * Create a new user-scheduled automation and register it in BullMQ using upsertJobScheduler
 */
export const createAutomation = async (data) => {
    const {
        title,
        store,
        user,
        taskType,
        frequency = "DAILY",
        time = "09:00",
        daysOfWeek = [1],
        dayOfMonth = 1,
        runAt,
        cronExpression: customCron,
        config = {},
    } = data;

    let cronPattern = null;
    let schedulerId = `auto_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (frequency !== "ONCE") {
        cronPattern = buildCronExpression({
            frequency,
            time,
            daysOfWeek,
            dayOfMonth,
            customCron,
        });
    }

    // Save automation definition in MongoDB
    const automation = new Automation({
        title,
        store,
        user,
        taskType,
        frequency,
        time,
        daysOfWeek,
        dayOfMonth,
        runAt,
        cronExpression: cronPattern,
        bullJobId: schedulerId,
        status: "ACTIVE",
        config,
    });

    await automation.save();

    // Register job in BullMQ scheduled queue using modern upsertJobScheduler API
    if (scheduledQueue) {
        const stringAutomationId = automation._id.toString();
        if (frequency === "ONCE") {
            const delay = calculateOneTimeDelay(runAt);
            await scheduledQueue.add(
                "user_scheduled_automation",
                { automationId: stringAutomationId },
                { jobId: schedulerId, delay }
            );
            console.log(`⏰ [BullMQ Delay] One-time job '${title}' scheduled with delay ${delay}ms`);
        } else {
            // upsertJobScheduler calculates the future delay correctly and DOES NOT run immediately
            await scheduledQueue.upsertJobScheduler(
                schedulerId,
                {
                    pattern: cronPattern,
                    tz: "Asia/Kolkata", // Indian Standard Time (IST)
                },
                "user_scheduled_automation",
                { automationId: stringAutomationId }
            );
            console.log(`⏰ [BullMQ JobScheduler] Job '${title}' scheduled for ${time} IST [SchedulerID: ${schedulerId}, Pattern: ${cronPattern}]`);
        }
    }

    return automation;
};

/**
 * Get all automations for a store / user
 */
export const getAutomations = async (filter = {}) => {
    return await Automation.find(filter).populate("store", "storeName name").sort({ createdAt: -1 });
};

/**
 * Pause or Resume an automation
 */
export const toggleAutomationStatus = async (automationId, newStatus) => {
    const automation = await Automation.findById(automationId);
    if (!automation) throw new Error("Automation not found");

    const schedulerId = automation.bullJobId;

    if (newStatus === "PAUSED") {
        if (scheduledQueue && schedulerId) {
            await scheduledQueue.removeJobScheduler(schedulerId).catch(() => {});
        }
        automation.status = "PAUSED";
    } else if (newStatus === "ACTIVE") {
        if (scheduledQueue && schedulerId && automation.cronExpression) {
            await scheduledQueue.upsertJobScheduler(
                schedulerId,
                {
                    pattern: automation.cronExpression,
                    tz: "Asia/Kolkata",
                },
                "user_scheduled_automation",
                { automationId: automation._id }
            );
        }
        automation.status = "ACTIVE";
    }

    await automation.save();
    return automation;
};

/**
 * Delete an automation and remove its scheduled job
 */
export const deleteAutomation = async (automationId) => {
    const automation = await Automation.findById(automationId);
    if (!automation) throw new Error("Automation not found");

    const schedulerId = automation.bullJobId;
    if (scheduledQueue && schedulerId) {
        await scheduledQueue.removeJobScheduler(schedulerId).catch(() => {});
    }

    await Automation.findByIdAndDelete(automationId);
    return { success: true, id: automationId };
};

/**
 * Execute automation workflow (invoked by BullMQ worker when schedule fires)
 */
export const executeAutomationWorkflow = async (automationId) => {
    const automation = await Automation.findById(automationId).populate("store").populate("user", "email name");
    if (!automation || automation.status !== "ACTIVE") {
        console.log(`[Automation Execution] Skipped inactive or deleted automation: ${automationId}`);
        return;
    }

    const istTimeStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    console.log(`🚀 [Automation Execution] Running '${automation.title}' (${automation.taskType}) at ${istTimeStr} IST`);

    try {
        switch (automation.taskType) {
            case "LOW_STOCK_ALERT": {
                const storeId = automation.store?._id || automation.store;
                const lowStockItems = await Inventory.findLowStock(storeId);
                const recipientEmail = automation.config?.recipientEmail || automation.user?.email;

                console.log(`[AUTOMATION MAILER] Recipient: ${recipientEmail}, Low stock count: ${lowStockItems.length}`);

                if (recipientEmail) {
                    if (lowStockItems.length > 0) {
                        const formattedProducts = lowStockItems.map(item => ({
                            name: item.product?.productName || item.product?.name || "Product",
                            currentStock: item.quantity,
                            unit: item.product?.unit || "pcs",
                            brand: item.product?.brand || "-",
                            barcode: item.product?.barcode || "-",
                            category: item.product?.category || "General",
                            price: item.sellingPrice || item.product?.sellingPrice || 0,
                        }));

                        await sendLowStockNotificationEmail(recipientEmail, {
                            storeName: automation.store?.storeName || automation.store?.name || "Vyapar Sakha Store",
                            storeId: storeId,
                            lowStockThreshold: automation.config?.threshold || 10,
                            lowStockProducts: formattedProducts,
                        });
                        console.log(`✉️ [AUTOMATION MAILER] Low stock notification email sent to ${recipientEmail}`);
                    } else {
                        // Send healthy inventory notification so recipient receives email status confirmation
                        const healthyHtml = buildHealthyInventoryEmail({
                            storeName: automation.store?.storeName || automation.store?.name || "Vyapar Sakha Store",
                            storeId: storeId,
                            totalProductsCount: 0,
                            toEmail: recipientEmail,
                            formattedDate: `${istTimeStr} IST`,
                        });

                        await sendMailWithRetry({
                            to: recipientEmail,
                            subject: `✅ Inventory Health Status - ${automation.store?.storeName || automation.store?.name || "Vyapar Sakha"}`,
                            html: healthyHtml,
                        });
                        console.log(`✉️ [AUTOMATION MAILER] Inventory healthy status email sent to ${recipientEmail}`);
                    }
                } else {
                    console.warn(`⚠️ [AUTOMATION MAILER] Missing recipient email for automation ${automationId}`);
                }
                break;
            }

            case "SALES_SUMMARY": {
                const storeId = automation.store?._id || automation.store;
                const recipientEmail = automation.config?.recipientEmail || automation.user?.email;

                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);

                const salesToday = await Sale.find({ store: storeId, createdAt: { $gte: startOfDay } });
                const totalRevenue = salesToday.reduce((acc, s) => acc + (s.totalAmount || 0), 0);

                if (recipientEmail) {
                    const salesHtml = buildSalesSummaryEmail({
                        storeName: automation.store?.storeName || automation.store?.name || "Vyapar Sakha Store",
                        storeId: storeId,
                        salesCount: salesToday.length,
                        totalRevenue: totalRevenue,
                        formattedDate: `${istTimeStr} IST`,
                    });

                    await sendMailWithRetry({
                        to: recipientEmail,
                        subject: `📊 Daily Sales Summary Report - ${automation.store?.storeName || automation.store?.name || "Vyapar Sakha"}`,
                        html: salesHtml,
                    });
                    console.log(`✉️ [AUTOMATION MAILER] Sales summary email sent to ${recipientEmail}`);
                }
                break;
            }

            case "AI_DEMAND_FORECAST": {
                const storeId = automation.store?._id || automation.store;
                await addAiTask("generate_forecast", {
                    storeId,
                    timeframe: automation.config?.timeframe || "30d",
                });
                break;
            }

            case "EXCEL_REPORT_EXPORT": {
                await addAiTask("generate_excel_report", {
                    title: `${automation.title} - ${new Date().toISOString().split("T")[0]}`,
                    storeId: automation.store?._id || automation.store,
                });
                break;
            }

            default:
                console.warn(`[Automation] Unrecognized taskType '${automation.taskType}'`);
        }

        // Update execution metrics in MongoDB
        automation.lastRunAt = new Date();
        automation.runCount += 1;
        automation.lastExecutionStatus = "SUCCESS";
        automation.lastError = undefined;

        if (automation.frequency === "ONCE") {
            automation.status = "COMPLETED";
        }

        await automation.save();
        console.log(`✅ [Automation Execution] Successfully completed '${automation.title}'`);
    } catch (err) {
        console.error(`❌ [Automation Execution] Failed for '${automation.title}':`, err.message);
        automation.lastExecutionStatus = "FAILED";
        automation.lastError = err.message;
        await automation.save().catch(() => {});
        throw err;
    }
};
