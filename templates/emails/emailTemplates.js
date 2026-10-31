/**
 * templates/emails/emailTemplates.js
 * ==================================
 * Modern, professionally designed email templates for Vyapar Sakha.
 * Uses high-converting UI components: cards, pills, metrics, item lists, and buttons.
 */

import { renderEmailLayout } from "./emailLayout.js";

/**
 * 1. Employee / Store Invitation Template
 */
export const buildInviteEmail = ({
  storeName,
  roleName,
  ownerName,
  inviteUrl,
}) => {
  const contentHtml = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.6;">
      Hi there,
    </p>
    <p style="margin: 0 0 24px 0; font-size: 15px; color: #334155; line-height: 1.6;">
      <strong style="color: #0f172a;">${ownerName}</strong> has invited you to join their store workspace as an active team member on <strong style="color: #4f46e5;">Vyapar Sakha</strong>.
    </p>

    <!-- Details Card -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 20px 24px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
            <tr>
              <td style="padding-bottom: 12px; border-bottom: 1px dashed #cbd5e1;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Store Name</span>
                <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px;">🏪 ${storeName}</div>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 12px;">
                <span style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Assigned Role</span>
                <div style="margin-top: 4px;">
                  <span style="display: inline-block; background-color: #e0e7ff; color: #4338ca; font-size: 13px; font-weight: 700; padding: 3px 12px; border-radius: 6px;">
                    🛡️ ${roleName}
                  </span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Notice -->
    <p style="margin: 0 0 28px 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      ⏰ <em>This invitation link will expire automatically in <strong>48 hours</strong>.</em>
    </p>

    <!-- Primary Action Button -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom: 24px;">
      <tr>
        <td align="center">
          <a href="${inviteUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);">
            Accept Invitation & Get Started →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">
      Don't recognize this store? <a href="${inviteUrl}?action=decline" style="color: #ef4444; text-decoration: underline;">Decline invitation</a>
    </p>
  `;

  return renderEmailLayout({
    preheader: `You're invited by ${ownerName} to join ${storeName} on Vyapar Sakha`,
    brandTitle: storeName,
    badgeText: "Team Invitation",
    badgeBg: "#6366f1",
    title: "You're Invited to Join the Team",
    subtitle: `Collaborate seamlessly in ${storeName}`,
    contentHtml,
    footerNote: "If you did not expect an invite, no action is needed and you may safely disregard this message.",
  });
};

/**
 * 2. Low Stock Warning Alert Template
 */
export const buildLowStockEmail = ({
  storeName,
  storeId,
  lowStockThreshold = 10,
  lowStockProducts = [],
  formattedDate,
}) => {
  const dashboardUrl = `${
    process.env.FRONTEND_URL || "http://localhost:3000"
  }${storeId ? `/storeDashboard/${storeId}` : ""}`;

  const productRows = lowStockProducts
    .map((p, index) => {
      const isCritical = p.currentStock === 0;
      const badgeBg = isCritical ? "#fee2e2" : "#fef3c7";
      const badgeColor = isCritical ? "#b91c1c" : "#b45309";
      const statusText = isCritical ? "OUT OF STOCK" : `${p.currentStock} ${p.unit || "units"} REMAINING`;

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 14px 16px; font-size: 14px; font-weight: 600; color: #0f172a;">
            ${index + 1}. ${p.name}
            ${p.category ? `<div style="font-size: 11px; color: #64748b; font-weight: 400; margin-top: 2px;">${p.category}</div>` : ""}
            ${p.barcode && p.barcode !== "-" ? `<div style="font-size: 10px; color: #94a3b8; font-family: monospace;">SKU: ${p.barcode}</div>` : ""}
          </td>
          <td style="padding: 14px 16px; font-size: 13px; color: #64748b; text-align: center;">
            ${p.price ? `₹${Number(p.price).toFixed(2)}` : "-"}
          </td>
          <td style="padding: 14px 16px; text-align: right;">
            <span style="display: inline-block; background-color: ${badgeBg}; color: ${badgeColor}; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 9999px; letter-spacing: 0.04em;">
              ${statusText}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  const contentHtml = `
    <!-- Top Alert Banner -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 16px 20px;">
          <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 4px;">
            ⚠️ Urgent Attention Required
          </div>
          <div style="font-size: 13px; color: #7f1d1d; line-height: 1.5;">
            We detected <strong>${lowStockProducts.length} product(s)</strong> that have reached or fallen below your configured alert threshold of <strong>${lowStockThreshold} units</strong>.
          </div>
        </td>
      </tr>
    </table>

    <!-- Store Status Quick Bar -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom: 20px; font-size: 12px; color: #64748b;">
      <tr>
        <td><strong>Store:</strong> ${storeName}</td>
        <td align="right"><strong>Inspected:</strong> ${formattedDate}</td>
      </tr>
    </table>

    <!-- Table of low stock items -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 28px;">
      <thead>
        <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
          <th align="left" style="padding: 12px 16px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Product</th>
          <th align="center" style="padding: 12px 16px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Price</th>
          <th align="right" style="padding: 12px 16px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Stock Status</th>
        </tr>
      </thead>
      <tbody>
        ${productRows}
      </tbody>
    </table>

    <!-- Restock Action -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom: 16px;">
      <tr>
        <td align="center">
          <a href="${dashboardUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 12px; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.3);">
            Open Inventory to Reorder Now →
          </a>
        </td>
      </tr>
    </table>
  `;

  return renderEmailLayout({
    preheader: `[Action Required] ${lowStockProducts.length} low stock items in ${storeName}`,
    brandTitle: storeName,
    badgeText: "Inventory Alert",
    badgeBg: "#ef4444",
    title: "Low Stock Warning Alert",
    subtitle: `${storeName} • Automated Inventory Monitoring`,
    contentHtml,
    footerNote: "Automated trigger generated by Vyapar Sakha Real-Time Stock Engine.",
  });
};

/**
 * 3. Healthy Inventory Report Template
 */
export const buildHealthyInventoryEmail = ({
  storeName,
  storeId,
  totalProductsCount = 0,
  toEmail,
  formattedDate,
}) => {
  const dashboardUrl = `${
    process.env.FRONTEND_URL || "http://localhost:3000"
  }${storeId ? `/storeDashboard/${storeId}` : ""}`;

  const contentHtml = `
    <!-- Success Banner -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f0fdf4; border-left: 4px solid #10b981; border-radius: 8px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 18px 20px;">
          <div style="font-size: 15px; font-weight: 700; color: #065f46; margin-bottom: 4px;">
            🎉 All Inventory is Healthy & Well Stocked!
          </div>
          <div style="font-size: 13px; color: #047857; line-height: 1.5;">
            Great news! All products in <strong>${storeName}</strong> are currently well-stocked above their minimum alert levels. No items require immediate replenishment.
          </div>
        </td>
      </tr>
    </table>

    <!-- Quick Stats Metric Box -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 28px;">
      <tr>
        <td style="padding: 20px 24px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
            <tr>
              <td>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Inventory Status</div>
                <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px;">All Items In Stock</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">🕒 Check Time: <strong>${formattedDate}</strong></div>
              </td>
              <td align="right" valign="top">
                <span style="display: inline-block; background-color: #ecfdf5; color: #059669; font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 9999px; border: 1px solid #a7f3d0;">
                  100% HEALTHY ✅
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom: 16px;">
      <tr>
        <td align="center">
          <a href="${dashboardUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);">
            Open Store Dashboard →
          </a>
        </td>
      </tr>
    </table>
  `;

  return renderEmailLayout({
    preheader: `All inventory is healthy in ${storeName}`,
    brandTitle: storeName,
    badgeText: "Inventory Healthy",
    badgeBg: "#10b981",
    title: "All Inventory Healthy",
    subtitle: `${storeName} • Automated Stock Monitor`,
    contentHtml,
    footerNote: "Automated scheduled check delivered by Vyapar Sakha Automation Engine.",
  });
};

/**
 * 4. Daily Sales Summary Template (For Automations)
 */
export const buildSalesSummaryEmail = ({
  storeName,
  storeId,
  salesCount = 0,
  totalRevenue = 0,
  formattedDate,
}) => {
  const dashboardUrl = `${
    process.env.FRONTEND_URL || "http://localhost:3000"
  }${storeId ? `/storeDashboard/${storeId}` : ""}`;

  const contentHtml = `
    <!-- Top Summary Banner -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 8px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 16px 20px;">
          <div style="font-size: 15px; font-weight: 700; color: #1e40af; margin-bottom: 4px;">
            📊 Daily Sales Snapshot
          </div>
          <div style="font-size: 13px; color: #1e3a8a; line-height: 1.5;">
            Here is your automated sales performance summary for <strong>${storeName}</strong> recorded up to <strong>${formattedDate}</strong>.
          </div>
        </td>
      </tr>
    </table>

    <!-- Metrics Grid -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 28px;">
      <tr>
        <td style="padding: 24px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
            <tr>
              <td width="50%" style="border-right: 1px solid #e2e8f0; padding-right: 16px;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Total Orders Today</div>
                <div style="font-size: 26px; font-weight: 800; color: #2563eb; margin-top: 6px;">${salesCount}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Completed transactions</div>
              </td>
              <td width="50%" style="padding-left: 16px;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Total Revenue</div>
                <div style="font-size: 26px; font-weight: 800; color: #059669; margin-top: 6px;">₹${Number(totalRevenue).toFixed(2)}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Gross revenue recorded</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom: 16px;">
      <tr>
        <td align="center">
          <a href="${dashboardUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);">
            Open Sales Analytics →
          </a>
        </td>
      </tr>
    </table>
  `;

  return renderEmailLayout({
    preheader: `Daily Sales Summary for ${storeName}: ₹${Number(totalRevenue).toFixed(2)} (${salesCount} orders)`,
    brandTitle: storeName,
    badgeText: "Daily Analytics",
    badgeBg: "#2563eb",
    title: "Daily Sales Summary",
    subtitle: `${storeName} • Performance on ${formattedDate}`,
    contentHtml,
    footerNote: "Automated daily digest delivered by Vyapar Sakha Automation Engine.",
  });
};

/**
 * 5. Customer Tax Invoice Email Template
 */
export const buildInvoiceEmail = ({
  storeName,
  customerName,
  invoiceNo,
  formattedDate,
  grandTotal,
  itemsCount,
  paymentMethod,
  paymentStatus,
}) => {
  const contentHtml = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.6;">
      Dear <strong style="color: #0f172a;">${customerName}</strong>,
    </p>
    <p style="margin: 0 0 24px 0; font-size: 15px; color: #334155; line-height: 1.6;">
      Thank you for shopping at <strong style="color: #0f172a;">${storeName}</strong>! Your purchase invoice has been generated and the official Tax Invoice PDF is attached to this email.
    </p>

    <!-- Invoice Summary Card -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 24px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px dashed #cbd5e1;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                  <tr>
                    <td>
                      <span style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Invoice Number</span>
                      <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 2px;">#${invoiceNo}</div>
                    </td>
                    <td align="right">
                      <span style="display: inline-block; background-color: #ecfdf5; color: #059669; font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 9999px;">
                        ${paymentStatus}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 16px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                  <tr>
                    <td style="font-size: 13px; color: #64748b;">Billing Date:</td>
                    <td align="right" style="font-size: 13px; font-weight: 600; color: #0f172a;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; color: #64748b; padding-top: 6px;">Total Items:</td>
                    <td align="right" style="font-size: 13px; font-weight: 600; color: #0f172a; padding-top: 6px;">${itemsCount} item(s)</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; color: #64748b; padding-top: 6px;">Payment Mode:</td>
                    <td align="right" style="font-size: 13px; font-weight: 600; color: #0f172a; padding-top: 6px;">${paymentMethod}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 15px; font-weight: 700; color: #0f172a; padding-top: 14px; border-top: 1px solid #e2e8f0;">Total Amount:</td>
                    <td align="right" style="font-size: 20px; font-weight: 800; color: #4f46e5; padding-top: 14px; border-top: 1px solid #e2e8f0;">₹${grandTotal.toFixed(2)}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #eff6ff; border-radius: 10px; margin-bottom: 24px;">
      <tr>
        <td style="padding: 14px 18px; font-size: 13px; color: #1e40af; line-height: 1.5;">
          📎 <strong>Attachment:</strong> A copy of your PDF receipt (<code>Tax_Invoice_${invoiceNo}.pdf</code>) is attached for your records and accounting.
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 14px; color: #64748b; line-height: 1.6;">
      Warm regards,<br/>
      <strong style="color: #0f172a;">Team ${storeName}</strong>
    </p>
  `;

  return renderEmailLayout({
    preheader: `Tax invoice ${invoiceNo} from ${storeName} for ₹${grandTotal.toFixed(2)}`,
    brandTitle: storeName,
    badgeText: "Tax Invoice",
    badgeBg: "#059669",
    title: `Invoice #${invoiceNo}`,
    subtitle: `Total ₹${grandTotal.toFixed(2)} • Thank you for your business!`,
    contentHtml,
    footerNote: `Official sales invoice issued by ${storeName} via Vyapar Sakha POS.`,
  });
};

/**
 * 6. General / AI Service Communication Template
 * Used by the AI Agent and Express /api/email/send route to wrap any dynamic message
 */
export const buildGenericDispatchedEmail = ({
  subject,
  htmlBody,
  storeName = "Vyapar Sakha Store",
  badgeText = "Store Notice",
}) => {
  return renderEmailLayout({
    preheader: subject,
    brandTitle: storeName,
    badgeText: badgeText,
    badgeBg: "#4f46e5",
    title: subject,
    subtitle: `Notice from ${storeName}`,
    contentHtml: htmlBody,
    footerNote: "Delivered via Vyapar Sakha Communications Service.",
  });
};
