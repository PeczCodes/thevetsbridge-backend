/**
 * Transactional Email Templates for VetsBridge
 * Styled with VetsBridge Brand Theme: Clean White & Accent Blue (#4A90E2)
 */

function stripHtml(htmlStr: string): string {
  return htmlStr
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&times;/g, 'x')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

const baseLayout = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>VetsBridge Notification</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; }
    
    .wrapper { width: 100%; background-color: #f8fafc; padding: 40px 16px; box-sizing: border-box; }
    .main-card { max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03); }
    
    .header { background-color: #ffffff; padding: 24px 36px; border-bottom: 2px solid #f1f5f9; text-align: left; }
    .brand-logo { font-size: 24px; font-weight: 700; color: #4A90E2; text-decoration: none; letter-spacing: -0.5px; }
    
    .content { padding: 36px; line-height: 1.6; }
    .content h2 { color: #0f172a; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 16px; letter-spacing: -0.3px; }
    .content h3 { color: #1e293b; font-size: 16px; font-weight: 600; margin-top: 24px; margin-bottom: 12px; }
    .content p { font-size: 15px; margin-top: 0; margin-bottom: 18px; color: #475569; }
    .content ul, .content ol { margin-top: 0; margin-bottom: 20px; padding-left: 20px; color: #475569; }
    .content li { font-size: 15px; margin-bottom: 8px; }
    
    .btn-container { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background-color: #4A90E2; color: #ffffff !important; text-decoration: none; padding: 13px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; text-align: center; box-shadow: 0 2px 6px rgba(74, 144, 226, 0.25); }
    .btn-danger { background-color: #dc2626 !important; box-shadow: 0 2px 6px rgba(220, 38, 38, 0.25) !important; }
    
    .info-card { background-color: #f0f7ff; border: 1px solid #dbeafe; border-left: 4px solid #4A90E2; border-radius: 8px; padding: 16px 20px; margin: 24px 0; color: #1e3a8a; font-size: 14px; line-height: 1.5; }
    .alert-card { background-color: #fef2f2; border: 1px solid #fee2e2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 16px 20px; margin: 24px 0; color: #991b1b; font-size: 14px; line-height: 1.5; }
    
    .data-table-container { margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    table.data-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    table.data-table th { background-color: #f8fafc; color: #475569; font-weight: 600; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
    table.data-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    table.data-table tr:last-child td { border-bottom: none; }
    .text-right { text-align: right; }
    .font-semibold { font-weight: 600; }
    
    .footer { background-color: #f8fafc; padding: 24px 36px; text-align: center; border-top: 1px solid #f1f5f9; font-size: 13px; color: #64748b; }
    .footer a { color: #4A90E2; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="main-card">
      <div class="header">
        <table border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: middle; padding-right: 10px;">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                <rect width="32" height="32" rx="8" fill="#4A90E2"/>
                <path d="M16 7.5C14.62 7.5 13.5 8.62 13.5 10C13.5 11.38 14.62 12.5 16 12.5C17.38 12.5 18.5 11.38 18.5 10C18.5 8.62 17.38 7.5 16 7.5Z" fill="white"/>
                <path d="M10 11.5C8.9 11.5 8 12.4 8 13.5C8 14.6 8.9 15.5 10 15.5C11.1 15.5 12 14.6 12 13.5C12 12.4 11.1 11.5 10 11.5Z" fill="white"/>
                <path d="M22 11.5C20.9 11.5 20 12.4 20 13.5C20 14.6 20.9 15.5 22 15.5C23.1 15.5 24 14.6 24 13.5C24 12.4 23.1 11.5 22 11.5Z" fill="white"/>
                <path d="M16 14.5C12.7 14.5 10 16.8 10 19.5C10 21.2 11.5 23.5 16 23.5C20.5 23.5 22 21.2 22 19.5C22 16.8 19.3 14.5 16 14.5Z" fill="white"/>
              </svg>
            </td>
            <td style="vertical-align: middle;">
              <span class="brand-logo">VetsBridge</span>
            </td>
          </tr>
        </table>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p style="margin: 0 0 6px 0;">This email was sent automatically by VetsBridge.</p>
        <p style="margin: 0 0 12px 0;">&copy; 2026 VetsBridge. All rights reserved.</p>
        <p style="margin: 0;"><a href="https://vetsbridge.org">Visit Platform</a> &bull; <a href="mailto:support@vetsbridge.org">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>
`;

export function getEmailTemplate(templateName: string, context: any): { subject: string; html: string; text: string } {
  let subject = "VetsBridge Notification";
  let content = "";

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  switch (templateName) {
    case 'WELCOME':
      subject = "Welcome to VetsBridge 🐾";
      const welcomeSteps = 
        context.role === 'VET' 
          ? `<li>Complete your professional credentials in your profile tab.</li>
             <li>Set your consultation availability in the schedule calendar.</li>
             <li>Administrators will review your credentials within 24-48 hours.</li>`
          : context.role === 'VENDOR'
          ? `<li>Define your store business details.</li>
             <li>Add your animal feed, medicine, or product listings inside the products page.</li>
             <li>Wait for admin store validation before products go live on our marketplace.</li>`
          : `<li>Add your pet or livestock profiles in the "My Animals" page.</li>
             <li>Explore verified veterinarians and book a virtual consultation.</li>
             <li>Shop for high-quality pet supplies in the integrated marketplace.</li>`;

      content = `
        <h2>Welcome to VetsBridge, ${context.name}!</h2>
        <p>We are delighted to have you join our platform community as a <strong>${context.role}</strong>.</p>
        <p>VetsBridge connects animal owners directly with licensed veterinary practitioners and verified healthcare vendors.</p>
        
        <h3>Next Steps to Get Started:</h3>
        <ul>
          ${welcomeSteps}
        </ul>
        
        <div class="btn-container">
          <a href="${frontendUrl}/auth/login" class="btn">Access Your Dashboard</a>
        </div>
      `;
      break;

    case 'ORDER_CONFIRMED_BUYER':
      subject = "Your VetsBridge Order Receipt 📦";
      const buyerItems = context.items.map((item: any) => `
        <tr>
          <td>${item.name} (x${item.quantity})</td>
          <td class="text-right">₦${(item.price * item.quantity).toLocaleString()}</td>
        </tr>
      `).join('');

      content = `
        <h2>Order Confirmation</h2>
        <p>Hi ${context.buyerName}, thank you for your purchase. Your order has been placed successfully and is being processed by our vendor network.</p>
        
        <div class="info-card">
          <strong>Order Reference:</strong> #${context.orderId}
        </div>
        
        <div class="data-table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item Description</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${buyerItems}
              <tr>
                <td class="font-semibold">Subtotal</td>
                <td class="text-right font-semibold">₦${context.subtotal.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Shipping & Handling</td>
                <td class="text-right">₦${context.shippingCost.toLocaleString()}</td>
              </tr>
              <tr style="background-color: #f8fafc;">
                <td class="font-semibold" style="font-size: 15px;">Total Charged</td>
                <td class="font-semibold text-right" style="font-size: 15px; color: #4A90E2;">₦${context.totalAmount.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p><strong>Shipping Address:</strong><br>${context.shippingAddress}</p>
      `;
      break;

    case 'ORDER_RECEIVED_VENDOR':
      subject = "New Order Received! 🎉";
      const vendorItems = context.items.map((item: any) => `
        <tr>
          <td>${item.name}</td>
          <td class="text-right">${item.quantity}</td>
          <td class="text-right">₦${(item.price * item.quantity).toLocaleString()}</td>
        </tr>
      `).join('');

      content = `
        <h2>New Customer Order</h2>
        <p>Hello ${context.vendorBusinessName},</p>
        <p>A customer has placed an order containing your products. Please review the shipment details below to dispatch the items.</p>
        
        <div class="info-card">
          <strong>Order Reference:</strong> #${context.orderId}
        </div>
        
        <div class="data-table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Earnings</th>
              </tr>
            </thead>
            <tbody>
              ${vendorItems}
            </tbody>
          </table>
        </div>
        
        <p><strong>Delivery Destination:</strong><br>${context.shippingAddress}</p>
        
        <div class="btn-container">
          <a href="${frontendUrl}/dashboard/vendor/orders" class="btn">Manage Orders</a>
        </div>
      `;
      break;

    case 'CONSULTATION_SCHEDULED_CUSTOMER':
      subject = "Your Consultation is Confirmed 🗓️";
      content = `
        <h2>Consultation Confirmed</h2>
        <p>Hi ${context.customerName},</p>
        <p>Your telemedicine consultation appointment has been scheduled successfully. Here are the booking details:</p>
        
        <div class="data-table-container">
          <table class="data-table">
            <tbody>
              <tr>
                <td class="font-semibold" style="width: 35%;">Veterinarian</td>
                <td>Dr. ${context.vetName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="font-semibold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="info-card">
          Please sign in to your dashboard at the scheduled time to launch the video consultation call room.
        </div>
        
        <div class="btn-container">
          <a href="${frontendUrl}/dashboard/customer" class="btn">View Appointments</a>
        </div>
      `;
      break;

    case 'CONSULTATION_SCHEDULED_VET':
      subject = "New Consultation Booking 🗓️";
      content = `
        <h2>New Patient Appointment Booked</h2>
        <p>Hello Dr. ${context.vetName},</p>
        <p>A new virtual consultation appointment has been scheduled by an animal owner. Here are the details:</p>
        
        <div class="data-table-container">
          <table class="data-table">
            <tbody>
              <tr>
                <td class="font-semibold" style="width: 35%;">Client Name</td>
                <td>${context.customerName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="font-semibold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="info-card">
          Please ensure your console status is available and join the session at the scheduled time.
        </div>
        
        <div class="btn-container">
          <a href="${frontendUrl}/dashboard/vet" class="btn">Open Vet Console</a>
        </div>
      `;
      break;

    case 'CONSULTATION_REMINDER_CUSTOMER':
      subject = "Reminder: Consultation starts in 1 hour 🐾";
      content = `
        <h2>Consultation Starting Soon</h2>
        <p>Hi ${context.customerName},</p>
        <p>This is a quick reminder that your veterinary consultation begins in exactly <strong>1 hour</strong>.</p>
        
        <div class="data-table-container">
          <table class="data-table">
            <tbody>
              <tr>
                <td class="font-semibold" style="width: 35%;">Veterinarian</td>
                <td>Dr. ${context.vetName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="font-semibold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="btn-container">
          <a href="${frontendUrl}/dashboard/customer" class="btn">Join Session</a>
        </div>
      `;
      break;

    case 'CONSULTATION_REMINDER_VET':
      subject = "Reminder: Consultation starts in 1 hour 🗓️";
      content = `
        <h2>Patient Consultation Starting Soon</h2>
        <p>Hello Dr. ${context.vetName},</p>
        <p>This is a reminder that your patient consultation begins in exactly <strong>1 hour</strong>.</p>
        
        <div class="data-table-container">
          <table class="data-table">
            <tbody>
              <tr>
                <td class="font-semibold" style="width: 35%;">Client Name</td>
                <td>${context.customerName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="font-semibold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="font-semibold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="btn-container">
          <a href="${frontendUrl}/dashboard/vet" class="btn">Open Vet Console</a>
        </div>
      `;
      break;

    case 'PROFILE_APPROVED':
      subject = "Your VetsBridge Profile is Approved 🎉";
      content = `
        <h2>Application Approved!</h2>
        <p>Hello ${context.name},</p>
        <p>We are pleased to inform you that your application for a <strong>${context.profileType}</strong> profile has been verified and approved by our administration team.</p>
        
        <div class="info-card">
          All platform features are active. You can now configure availability, manage listings, and receive client bookings.
        </div>
        
        <div class="btn-container">
          <a href="${frontendUrl}/auth/login" class="btn">Log In to Dashboard</a>
        </div>
      `;
      break;

    case 'PROFILE_REJECTED':
      subject = "Action Required: Profile Application Update ⚠️";
      content = `
        <h2>Application Update Required</h2>
        <p>Hello ${context.name},</p>
        <p>Your application for a <strong>${context.profileType}</strong> profile requires additional review details before approval.</p>
        
        <p><strong>Administrative Note:</strong></p>
        <div class="alert-card">
          "${context.rejectionReason}"
        </div>
        
        <p>Please log in to update your credentials and resubmit your application for review.</p>
        
        <div class="btn-container">
          <a href="${frontendUrl}/auth/login" class="btn">Update Profile Details</a>
        </div>
      `;
      break;

    case 'USER_PASSWORD_RESET':
      subject = "VetsBridge Password Reset Request 🔐";
      const resetLink = `${frontendUrl}/auth/reset-password?token=${context.token}`;
      content = `
        <h2>Password Reset Request</h2>
        <p>Hello ${context.name},</p>
        <p>We received a password reset request for your VetsBridge account. Click the button below to set a new secure password:</p>
        
        <div class="btn-container">
          <a href="${resetLink}" class="btn btn-danger">Reset Password</a>
        </div>

        <div class="info-card">
          <strong>Security Notice:</strong> This link expires in 30 minutes. If you did not request a password reset, you can safely ignore this email.
        </div>

        <p style="word-break: break-all; font-size: 13px; color: #64748b; margin-top: 16px;">
          Direct Link: <a href="${resetLink}" style="color: #4A90E2;">${resetLink}</a>
        </p>
      `;
      break;

    case 'USER_STATUS_CHANGED':
      subject = context.isActive ? "VetsBridge Account Re-activated 🎉" : "VetsBridge Account Status Update ⚠️";
      content = context.isActive 
        ? `
            <h2>Account Re-activated</h2>
            <p>Hello ${context.name},</p>
            <p>Your VetsBridge account has been successfully reactivated. Full access to your dashboard and services has been restored.</p>
            
            <div class="btn-container">
              <a href="${frontendUrl}/auth/login" class="btn">Access Dashboard</a>
            </div>
          `
        : `
            <h2>Account Suspended</h2>
            <p>Hello ${context.name},</p>
            <p>Your VetsBridge account has been temporarily suspended by our administrative team.</p>
            
            <div class="alert-card">
              Access to consultations, appointments, orders, and marketplace features is currently paused.
            </div>
            
            <p>If you have questions or wish to inquire, please contact support at <a href="mailto:compliance@vetsbridge.org" style="color: #4A90E2;">compliance@vetsbridge.org</a>.</p>
          `;
      break;

    default:
      content = `<h2>Notification Update</h2><p>${JSON.stringify(context)}</p>`;
  }

  const html = baseLayout(content);
  const text = stripHtml(content);

  return {
    subject,
    html,
    text,
  };
}

