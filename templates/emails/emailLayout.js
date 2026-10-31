/**
 * templates/emails/emailLayout.js
 * ===============================
 * Production-grade, cross-client responsive email shell for Vyapar Sakha.
 * Compatible with Gmail, Apple Mail, Outlook (Windows/Mac/Web), Yahoo, iOS & Android.
 * Features:
 *  - Modern typography with 'Plus Jakarta Sans' / 'Inter' + clean system fallbacks
 *  - Brand gradient accent headers with badge pill
 *  - Subtle drop-shadow card layout on neutral slate background
 *  - High-contrast, accessibility-checked text & buttons
 *  - Standard mobile viewport scaling and preview-preheader support
 */

export const renderEmailLayout = ({
  preheader = "",
  brandTitle = "Vyapar Sakha",
  badgeText = "Store Notice",
  badgeBg = "#4f46e5",
  title = "",
  subtitle = "",
  contentHtml = "",
  footerNote = "",
  currentYear = new Date().getFullYear(),
}) => {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${title || brandTitle}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
    
    /* Reset styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #f1f5f9; font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }

    /* Client-safe interactive components */
    .btn-primary:hover {
      background-color: #4338ca !important;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
        margin: 0 !important;
        border-radius: 0 !important;
      }
      .mobile-padding {
        padding-left: 20px !important;
        padding-right: 20px !important;
      }
      .stack-column {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 32px 12px; background-color: #f1f5f9; -webkit-font-smoothing: antialiased;">
  ${
    preheader
      ? `<!-- Hidden preheader text -->
  <div style="display: none; font-size: 1px; color: #f1f5f9; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${preheader} &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>`
      : ""
  }

  <!-- Main Container Wrapper -->
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
    <tr>
      <td align="center">
        <!-- Center Card -->
        <table class="email-container" border="0" cellpadding="0" cellspacing="0" width="580" role="presentation" style="max-width: 580px; width: 100%; background-color: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px -5px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.8);">
          
          <!-- Modern Accent Header Bar -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%); padding: 36px 36px 32px 36px; text-align: left;" class="mobile-padding">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td>
                    <!-- Brand Pill Badge -->
                    <span style="display: inline-block; background-color: ${badgeBg}; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 4px 12px; border-radius: 9999px; margin-bottom: 12px;">
                      ${badgeText}
                    </span>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; line-height: 1.25;">
                      ${title || brandTitle}
                    </h1>
                    ${
                      subtitle
                        ? `<p style="margin: 8px 0 0 0; font-size: 14px; color: #cbd5e1; line-height: 1.5; font-weight: 400;">${subtitle}</p>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 36px 28px 36px; background-color: #ffffff;" class="mobile-padding">
              ${contentHtml}
            </td>
          </tr>

          <!-- Clean Branded Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 36px; border-top: 1px solid #f1f5f9; text-align: center;" class="mobile-padding">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                <tr>
                  <td align="center" style="font-size: 12px; line-height: 1.6; color: #94a3b8; font-weight: 500;">
                    ${
                      footerNote
                        ? `<div style="margin-bottom: 8px; color: #64748b;">${footerNote}</div>`
                        : ""
                    }
                    <div>
                      Sent with precision via <strong style="color: #475569;">Vyapar Sakha</strong> • AI & Modern Inventory Suite
                    </div>
                    <div style="margin-top: 4px; font-size: 11px; color: #cbd5e1;">
                      © ${currentYear} Vyapar Sakha. All rights reserved.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

