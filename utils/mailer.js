import { Resend } from "resend";
import PDFDocument from "pdfkit";
import {
  buildInviteEmail,
  buildLowStockEmail,
  buildHealthyInventoryEmail,
  buildInvoiceEmail,
} from "../templates/emails/emailTemplates.js";

// ---------------------------------------------------------------------------
// Resend client — created lazily so env vars are always read AFTER dotenv.config()
// ---------------------------------------------------------------------------

/**
 * Return a configured Resend client.
 * Logs a clear error if RESEND_API_KEY is missing.
 */
const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "[MAILER CONFIG ERROR] Missing RESEND_API_KEY! Add it to your environment variables (e.g. Render Environment Settings)."
    );
  }
  return new Resend(apiKey);
};

/**
 * The "from" address used for all outgoing emails.
 * Reads MAIL_FROM_ADDRESS from env; defaults to the Resend sandbox address.
 */
const getFromAddress = (label = "Vyapar Sakha") => {
  const address =
    process.env.MAIL_FROM_ADDRESS?.trim() || "onboarding@resend.dev";
  return `"${label}" <${address}>`;
};

// ---------------------------------------------------------------------------
// Core retry helper
// ---------------------------------------------------------------------------

/**
 * Send an email via Resend with automatic retry on failure.
 *
 * @param {object} mailOptions         - { from, to, subject, html, [replyTo] }
 * @param {number} [maxRetries=3]      - Number of retries after the first failure
 * @param {number} [delayMs=3000]      - Pause between retries (ms)
 */
export const sendMailWithRetry = async (
  mailOptions,
  maxRetries = 3,
  delayMs = 3000
) => {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const resend = getResendClient();

      const from = mailOptions.from || getFromAddress();

      const { data, error } = await resend.emails.send({
        from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
        ...(mailOptions.replyTo ? { reply_to: mailOptions.replyTo } : {}),
        ...(mailOptions.attachments ? { attachments: mailOptions.attachments } : {}),
      });

      if (error) {
        // Resend returns errors in-band rather than throwing
        throw new Error(error.message || JSON.stringify(error));
      }

      if (attempt > 0) {
        console.log(
          `[MAILER] Email successfully sent to ${mailOptions.to} on retry attempt #${attempt} (id: ${data?.id})`
        );
      }

      return data;
    } catch (err) {
      attempt++;
      if (attempt <= maxRetries) {
        console.warn(
          `[MAILER WARNING] Failed to send email to ${mailOptions.to} (Attempt ${attempt}/${
            maxRetries + 1
          }): ${err.message}. Retrying in ${delayMs / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        console.error(
          `[MAILER ERROR] Max retries (${maxRetries}) reached. Could not send email to ${mailOptions.to}:`,
          err.message
        );
        throw err;
      }
    }
  }
};

// ---------------------------------------------------------------------------
// sendInviteEmail
// ---------------------------------------------------------------------------

/**
 * Send a store employee invitation email with the accept link.
 *
 * @param {string} toEmail - Recipient's email address
 * @param {object} opts
 * @param {string} opts.storeName   - Name of the store
 * @param {string} opts.roleName    - Role being assigned
 * @param {string} opts.ownerName   - Owner's name
 * @param {string} opts.inviteToken - The unique token
 * @param {object} [retryOpts]      - Custom retry options { maxRetries, delayMs }
 */
export const sendInviteEmail = async (
  toEmail,
  { storeName, roleName, ownerName, inviteToken },
  retryOpts = {}
) => {
  const inviteUrl = `${process.env.FRONTEND_URL}/invite/${inviteToken}`;

  const html = buildInviteEmail({
    storeName,
    roleName,
    ownerName,
    inviteUrl,
  });

  const maxRetries = retryOpts.maxRetries ?? 3;
  const delayMs = retryOpts.delayMs ?? 60000;

  await sendMailWithRetry(
    {
      from: getFromAddress("Vyapar Sakha"),
      to: toEmail,
      subject: `You're invited to join ${storeName} on Vyapar Sakha`,
      html,
    },
    maxRetries,
    delayMs
  );
};

// ---------------------------------------------------------------------------
// sendLowStockNotificationEmail
// ---------------------------------------------------------------------------

/**
 * Send a Low Stock Warning Email to the Store Owner when products fall below threshold.
 *
 * @param {string} toEmail - Recipient email (Store Email or Owner Email)
 * @param {object} opts
 * @param {string} opts.storeName           - Name of the store
 * @param {string} opts.storeId             - Store ID for dashboard link
 * @param {number} [opts.lowStockThreshold=10] - Threshold set during store creation
 * @param {Array}  opts.lowStockProducts    - List of low stock product objects
 * @param {object} [retryOpts]              - Custom retry options { maxRetries, delayMs }
 */
export const sendLowStockNotificationEmail = async (
  toEmail,
  { storeName, storeId, lowStockThreshold = 10, lowStockProducts = [] },
  retryOpts = {}
) => {
  if (!toEmail || !lowStockProducts || lowStockProducts.length === 0) return;

  const formattedDate = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const html = buildLowStockEmail({
    storeName,
    storeId,
    lowStockThreshold,
    lowStockProducts,
    formattedDate,
  });

  const maxRetries = retryOpts.maxRetries ?? 3;
  const delayMs = retryOpts.delayMs ?? 60000;

  try {
    await sendMailWithRetry(
      {
        from: getFromAddress("Vyapar Sakha Alert"),
        to: toEmail,
        subject: `⚠️ Low Stock Alert: ${lowStockProducts.length} Product(s) Need Restocking in ${storeName}`,
        html,
      },
      maxRetries,
      delayMs
    );
  } catch (err) {
    console.error(
      `[MAILER ERROR] Failed to send low stock alert email to ${toEmail}:`,
      err.message
    );
  }
};

// ---------------------------------------------------------------------------
// sendHealthyInventoryNotificationEmail
// ---------------------------------------------------------------------------

/**
 * Send an Inventory Health / All Good Status Email to the Store Owner.
 *
 * @param {string} toEmail - Recipient email (Store Email or Owner Email)
 * @param {object} opts
 * @param {string} opts.storeName           - Name of the store
 * @param {string} opts.storeId             - Store ID for dashboard link
 * @param {number} [opts.totalProductsCount=0] - Total products checked
 * @param {object} [retryOpts]              - Custom retry options { maxRetries, delayMs }
 */
export const sendHealthyInventoryNotificationEmail = async (
  toEmail,
  { storeName, storeId, totalProductsCount = 0 },
  retryOpts = {}
) => {
  if (!toEmail) return;

  const formattedDate = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const html = buildHealthyInventoryEmail({
    storeName,
    storeId,
    totalProductsCount,
    toEmail,
    formattedDate,
  });

  const maxRetries = retryOpts.maxRetries ?? 3;
  const delayMs = retryOpts.delayMs ?? 60000;

  try {
    await sendMailWithRetry(
      {
        from: getFromAddress("Vyapar Sakha"),
        to: toEmail,
        subject: `✅ All Good: Inventory Healthy Status for ${storeName}`,
        html,
      },
      maxRetries,
      delayMs
    );
  } catch (err) {
    console.error(
      `[MAILER ERROR] Failed to send healthy inventory email to ${toEmail}:`,
      err.message
    );
  }
};

// ---------------------------------------------------------------------------
// generateInvoicePDFBuffer — Node.js PDF using PDFKit
// ---------------------------------------------------------------------------

/**
 * Generates a professional Tax Invoice PDF using PDFKit (Node.js compatible)
 * Returns a Buffer that can be attached to emails.
 */
const generateInvoicePDFBuffer = (billData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const store = billData.storeInfo || billData.store || {};
      const storeName = store.name || store.storeName || billData.storeName || "Vyapar Sakha Store";
      const storeAddress = store.address || store.fullAddress || "";
      const storePhone = store.phone || store.mobile || "";
      const storeEmail = store.email || "";
      const storeGstin = store.gstin || store.gstNumber || billData.gstin || "";

      const customerName = billData.customerName || billData.buyer?.name || "Valued Customer";
      const customerPhone = billData.customerPhone || billData.buyer?.phone || "";
      const customerEmail = billData.customerEmail || billData.buyer?.email || "";
      const invoiceId = String(billData._id || "");
      const invoiceNo = billData.billNumber || billData.invoiceNo || (invoiceId ? `INV-${invoiceId.slice(-8).toUpperCase()}` : `INV-${Date.now().toString().slice(-6)}`);
      const dateStr = billData.completedAt || billData.billedAt || billData.createdAt || new Date();
      const formattedDate = new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const paymentMethod = String(billData.paymentMethod || "CASH").toUpperCase();
      const paymentStatus = String(billData.paymentStatus || "PAID").toUpperCase();

      const products = billData.items || billData.products || [];
      let subtotal = 0;

      // ── Header ──────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 80).fill("#0f172a");
      doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text(storeName, 40, 20);
      doc.fontSize(8).font("Helvetica").fillColor("#94a3b8");
      if (storeAddress) doc.text(`📍 ${storeAddress}`, 40, 44);
      if (storePhone) doc.text(`📞 ${storePhone}   ${storeEmail ? `✉ ${storeEmail}` : ""}`, 40, 55);
      if (storeGstin) doc.text(`GSTIN: ${storeGstin}`, 40, 66);

      // TAX INVOICE badge (top right)
      doc.rect(doc.page.width - 130, 20, 90, 22).fill("#10b981");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold").text("TAX INVOICE", doc.page.width - 130, 28, { width: 90, align: "center" });

      // ── Invoice meta ────────────────────────────────────────
      let y = 100;
      doc.fillColor("#0f172a").fontSize(8).font("Helvetica-Bold");
      doc.text("INVOICE DETAILS", 40, y);
      doc.font("Helvetica").fillColor("#475569");
      doc.text(`Invoice No: `, 40, y + 14, { continued: true }).fillColor("#0f172a").font("Helvetica-Bold").text(invoiceNo);
      doc.font("Helvetica").fillColor("#475569").text(`Date: ${formattedDate}`, 40, y + 26);
      doc.text(`Payment: ${paymentMethod} [${paymentStatus}]`, 40, y + 38);

      // Customer details (right column)
      doc.font("Helvetica-Bold").fillColor("#0f172a").text("BILLED TO", 320, y);
      doc.font("Helvetica-Bold").fillColor("#1e293b").text(customerName, 320, y + 14);
      doc.font("Helvetica").fillColor("#475569");
      if (customerPhone) doc.text(`Phone: ${customerPhone}`, 320, y + 26);
      if (customerEmail) doc.text(`Email: ${customerEmail}`, 320, y + 38);

      y += 65;
      doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      y += 10;

      // ── Items table header ──────────────────────────────────
      doc.rect(40, y, doc.page.width - 80, 18).fill("#0f172a");
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
      doc.text("#", 46, y + 5);
      doc.text("ITEM DESCRIPTION", 62, y + 5);
      doc.text("QTY", 340, y + 5, { width: 40, align: "center" });
      doc.text("RATE", 385, y + 5, { width: 60, align: "right" });
      doc.text("AMOUNT", 450, y + 5, { width: 70, align: "right" });
      y += 18;

      // ── Items table rows ────────────────────────────────────
      products.forEach((item, idx) => {
        if (idx % 2 === 0) doc.rect(40, y, doc.page.width - 80, 16).fill("#f8fafc");
        const name = item.nameSnapshot || item.name || item.product?.name || "Product Item";
        const qty = Number(item.quantity || item.qty || 1);
        const price = Number(item.unitPrice || item.price || 0);
        const lineTotal = Number(item.lineTotal || item.total || (qty * price));
        subtotal += lineTotal;

        doc.fillColor("#1e293b").font("Helvetica").fontSize(8);
        doc.text(String(idx + 1), 46, y + 4);
        doc.text(name.length > 40 ? name.slice(0, 40) + "..." : name, 62, y + 4);
        doc.text(String(qty), 340, y + 4, { width: 40, align: "center" });
        doc.text(`Rs.${price.toFixed(2)}`, 385, y + 4, { width: 60, align: "right" });
        doc.font("Helvetica-Bold").text(`Rs.${lineTotal.toFixed(2)}`, 450, y + 4, { width: 70, align: "right" });
        y += 16;
      });

      // ── Totals ──────────────────────────────────────────────
      y += 6;
      doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      y += 10;

      let discAmount = 0;
      if (typeof billData.discount === "object" && billData.discount !== null) {
        if (typeof billData.discount.amount === "number" && billData.discount.amount > 0) {
          discAmount = billData.discount.amount;
        } else if (typeof billData.discount.value === "number" && billData.discount.value > 0) {
          discAmount = billData.discount.type === "percent" ? (subtotal * billData.discount.value) / 100 : billData.discount.value;
        }
      } else if (typeof billData.discount === "number" && billData.discount > 0) {
        discAmount = billData.discount;
      }
      const gstAmount = Number(billData.taxAmount || billData.gstAmount || 0);
      const grandTotal = Math.max(0, subtotal - discAmount + gstAmount);

      const summaryX = doc.page.width - 220;
      doc.font("Helvetica").fillColor("#475569").fontSize(9);
      doc.text("Subtotal:", summaryX, y).text(`Rs. ${subtotal.toFixed(2)}`, summaryX + 120, y, { width: 60, align: "right" });
      y += 14;
      if (discAmount > 0) {
        doc.fillColor("#10b981").font("Helvetica-Bold");
        doc.text("Discount:", summaryX, y).text(`- Rs. ${discAmount.toFixed(2)}`, summaryX + 120, y, { width: 60, align: "right" });
        y += 14;
      }
      if (gstAmount > 0) {
        doc.fillColor("#475569").font("Helvetica");
        doc.text("GST Tax:", summaryX, y).text(`+ Rs. ${gstAmount.toFixed(2)}`, summaryX + 120, y, { width: 60, align: "right" });
        y += 14;
      }

      // Grand Total banner
      doc.rect(summaryX - 5, y, 185, 22).fill("#0f172a");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
      doc.text("GRAND TOTAL:", summaryX, y + 6).text(`Rs. ${grandTotal.toFixed(2)}`, summaryX + 100, y + 6, { width: 80, align: "right" });
      y += 32;

      // ── Footer ──────────────────────────────────────────────
      doc.moveTo(40, y + 20).lineTo(doc.page.width - 40, y + 20).strokeColor("#e2e8f0").stroke();
      doc.fillColor("#94a3b8").font("Helvetica").fontSize(7.5)
        .text("Thank you for shopping with us! This is a computer-generated official tax invoice.", 40, y + 26, { align: "center", width: doc.page.width - 80 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// ---------------------------------------------------------------------------
// sendInvoiceEmail
// ---------------------------------------------------------------------------

/**
 * Send an Official Tax Invoice Email to a Buyer/Customer
 *
 * @param {string} toEmail - Recipient email
 * @param {object} billData - Sale/Invoice object containing items, store, total, customer info
 * @param {object} [retryOpts] - Retry options
 */
export const sendInvoiceEmail = async (toEmail, billData, retryOpts = {}, pdfBase64Override = null) => {
  if (!toEmail) return;

  const store = billData.storeInfo || billData.store || {};
  const storeName = store.name || store.storeName || billData.storeName || "Vyapar Sakha Store";
  const storeAddress = store.address || store.fullAddress || "";
  const storePhone = store.phone || store.mobile || "";

  const customerName = billData.customerName || billData.buyer?.name || "Valued Customer";
  const invoiceId = String(billData._id || "");
  const invoiceNo = billData.billNumber || billData.invoiceNo || (invoiceId ? `INV-${invoiceId.slice(-8).toUpperCase()}` : "TAX-INVOICE");
  const dateStr = billData.completedAt || billData.billedAt || billData.createdAt || new Date();
  const formattedDate = new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const paymentMethod = String(billData.paymentMethod || billData.paymentMode || "CASH").toUpperCase();
  const paymentStatus = String(billData.paymentStatus || "PAID").toUpperCase();

  const products = billData.items || billData.products || [];
  let subtotal = 0;
  const itemsHtml = products
    .map((item, idx) => {
      const name = item.nameSnapshot || item.name || item.product?.name || "Product Item";
      const qty = Number(item.quantity || item.qty || 1);
      const price = Number(item.unitPrice || item.price || 0);
      const lineTotal = Number(item.lineTotal || item.total || (qty * price));
      subtotal += lineTotal;
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
          <td style="padding: 10px 12px; color: #64748b; text-align: center;">${idx + 1}</td>
          <td style="padding: 10px 12px; color: #0f172a; font-weight: 600;">${name}</td>
          <td style="padding: 10px 12px; color: #334155; text-align: center;">${qty}</td>
          <td style="padding: 10px 12px; color: #334155; text-align: right;">₹${price.toFixed(2)}</td>
          <td style="padding: 10px 12px; color: #0f172a; font-weight: 700; text-align: right;">₹${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");

  let discAmount = 0;
  if (typeof billData.discount === "object" && billData.discount !== null) {
    if (typeof billData.discount.amount === "number" && billData.discount.amount > 0) {
      discAmount = billData.discount.amount;
    } else if (typeof billData.discount.value === "number" && billData.discount.value > 0) {
      discAmount = billData.discount.type === "percent" ? (subtotal * billData.discount.value) / 100 : billData.discount.value;
    }
  } else if (typeof billData.discount === "number" && billData.discount > 0) {
    discAmount = billData.discount;
  }
  const grandTotal = Math.max(0, subtotal - discAmount);

  const html = buildInvoiceEmail({
    storeName,
    customerName,
    invoiceNo,
    formattedDate,
    grandTotal,
    itemsCount: products.length,
    paymentMethod,
    paymentStatus,
  });

  // Use frontend-generated PDF (same as bill history/print) if provided, else generate with PDFKit
  let attachmentBase64 = pdfBase64Override || null;
  if (!attachmentBase64) {
    try {
      const pdfBuffer = await generateInvoicePDFBuffer(billData);
      attachmentBase64 = pdfBuffer.toString("base64");
    } catch (pdfErr) {
      console.warn("[MAILER] Could not generate PDF attachment:", pdfErr.message);
    }
  }

  const maxRetries = retryOpts.maxRetries ?? 3;
  const delayMs = retryOpts.delayMs ?? 60000;

  await sendMailWithRetry(
    {
      from: getFromAddress(storeName),
      to: toEmail,
      subject: `Tax Invoice ${invoiceNo} from ${storeName}`,
      html,
      ...(attachmentBase64 ? {
        attachments: [{
          filename: `Tax_Invoice_${invoiceNo}.pdf`,
          content: attachmentBase64,
          type: "application/pdf",
          disposition: "attachment",
        }]
      } : {}),
    },
    maxRetries,
    delayMs
  );
};

