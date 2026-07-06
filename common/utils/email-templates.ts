/**
 * Transactional Email Templates for VetsBridge
 */

const baseLayout = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VetsBridge Notification</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f8fafc;
      color: #334155;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
    }
    .header {
      background-color: #1e293b;
      padding: 30px;
      text-align: center;
      border-bottom: 4px solid #4A90E2;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 24px;
      font-weight: 300;
      letter-spacing: 1px;
    }
    .header span {
      color: #4A90E2;
      font-weight: bold;
    }
    .content {
      padding: 40px 30px;
      line-height: 1.6;
    }
    .content h2 {
      color: #1e293b;
      font-size: 20px;
      margin-top: 0;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .content p {
      font-size: 15px;
      margin-bottom: 20px;
      color: #475569;
    }
    .btn {
      display: inline-block;
      background-color: #4A90E2;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 30px;
      font-size: 14px;
      font-weight: 600;
      margin: 20px 0;
      text-align: center;
      box-shadow: 0 4px 10px rgba(74, 144, 226, 0.2);
    }
    .feedback-box {
      background-color: #fef2f2;
      border: 1px solid #fee2e2;
      border-left: 4px solid #ef4444;
      border-radius: 8px;
      padding: 15px 20px;
      margin: 20px 0;
      font-style: italic;
      color: #991b1b;
    }
    .table-container {
      margin: 25px 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th {
      background-color: #f1f5f9;
      color: #475569;
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
    }
    .text-right {
      text-align: right;
    }
    .bold {
      font-weight: bold;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
    }
    .footer a {
      color: #4A90E2;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Vets<span>Bridge</span></h1>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>This is an automated notification from VetsBridge.</p>
        <p>&copy; 2026 VetsBridge. All rights reserved.</p>
        <p><a href="https://thevetsbridge.com">Visit our website</a> | <a href="mailto:support@thevetsbridge.com">Contact Support</a></p>
      </div>
    </div>
  </div>
</body>
</html>
`;

export function getEmailTemplate(templateName: string, context: any): { subject: string, html: string } {
  let subject = "VetsBridge Notification";
  let content = "";

  switch (templateName) {
    case 'WELCOME':
      subject = "Welcome to VetsBridge! 🐾";
      const welcomeSteps = 
        context.role === 'VET' 
          ? `<li>Complete your professional credentials in the profile tab.</li>
             <li>Set your practice availability blocks in the availability calendar.</li>
             <li>Administrators will review your credentials within 24-48 hours.</li>`
          : context.role === 'VENDOR'
          ? `<li>Define your store business details.</li>
             <li>Add your animal feed, medicine, or product listings inside the products page.</li>
             <li>Wait for admin store validation before products go live on our marketplace.</li>`
          : `<li>Add your pet or livestock profiles in the "My Animals" page.</li>
             <li>Explore verified veterinarians and book a video consultation.</li>
             <li>Shop for high-quality pet supplies in the integrated marketplace.</li>`;

      content = `
        <h2>Welcome to VetsBridge, ${context.name}!</h2>
        <p>We are absolutely thrilled to have you join our community as a <strong>${context.role}</strong>.</p>
        <p>VetsBridge connects pet and livestock owners directly with professional veterinary services and high-quality product vendors.</p>
        
        <h3>Next Steps to Get Started:</h3>
        <ul>
          ${welcomeSteps}
        </ul>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login" class="btn">Access Your Dashboard</a>
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
        <h2>Order Confirmed!</h2>
        <p>Hi ${context.buyerName}, thank you for your purchase on VetsBridge. Your order has been successfully placed and is being processed by our vendors.</p>
        
        <p><strong>Order ID:</strong> #${context.orderId}</p>
        
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Item Details</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${buyerItems}
              <tr>
                <td class="bold">Subtotal</td>
                <td class="text-right">₦${context.subtotal.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Shipping & Handling</td>
                <td class="text-right">₦${context.shippingCost.toLocaleString()}</td>
              </tr>
              <tr style="background-color: #f8fafc;">
                <td class="bold" style="font-size: 16px;">Total Charge</td>
                <td class="bold text-right" style="font-size: 16px; color: #4A90E2;">₦${context.totalAmount.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p><strong>Shipping Address:</strong><br>${context.shippingAddress}</p>
      `;
      break;

    case 'ORDER_RECEIVED_VENDOR':
      subject = "New Customer Order Received! 🎉";
      const vendorItems = context.items.map((item: any) => `
        <tr>
          <td>${item.name}</td>
          <td class="text-right">${item.quantity}</td>
          <td class="text-right">₦${(item.price * item.quantity).toLocaleString()}</td>
        </tr>
      `).join('');

      content = `
        <h2>New Order Received!</h2>
        <p>Hello ${context.vendorBusinessName},</p>
        <p>A customer has placed an order containing your products. Please review the details below and prepare the shipment.</p>
        
        <p><strong>Order Reference ID:</strong> #${context.orderId}</p>
        
        <div class="table-container">
          <table>
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
        
        <p><strong>Deliver To:</strong><br>${context.shippingAddress}</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/vendor/orders" class="btn">Manage Vendor Orders</a>
        </div>
      `;
      break;

    case 'CONSULTATION_SCHEDULED_CUSTOMER':
      subject = "Your Consultation is Scheduled! 🗓️";
      content = `
        <h2>Consultation Confirmed</h2>
        <p>Hi ${context.customerName},</p>
        <p>Your telemedicine consultation slot has been scheduled successfully. Here are the details:</p>
        
        <div class="table-container">
          <table>
            <tbody>
              <tr>
                <td class="bold">Veterinarian</td>
                <td>Dr. ${context.vetName}</td>
              </tr>
              <tr>
                <td class="bold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="bold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="bold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p>Please log in to your dashboard at the scheduled time, navigate to the consultation page, and launch the video call session.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/customer" class="btn">View Appointments</a>
        </div>
      `;
      break;

    case 'CONSULTATION_SCHEDULED_VET':
      subject = "New Consultation Booking Scheduled! 🗓️";
      content = `
        <h2>New Patient Appointment Booked</h2>
        <p>Hello Dr. ${context.vetName},</p>
        <p>A new virtual consultation appointment has been scheduled by an animal owner. Here are the details:</p>
        
        <div class="table-container">
          <table>
            <tbody>
              <tr>
                <td class="bold">Client Name</td>
                <td>${context.customerName}</td>
              </tr>
              <tr>
                <td class="bold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="bold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="bold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p>Please make sure to set your status to available and log in at the scheduled time to initiate the video consultation call room.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/vet" class="btn">Open Vet Console</a>
        </div>
      `;
      break;

    case 'CONSULTATION_REMINDER_CUSTOMER':
      subject = "Reminder: Your Consultation starts in 1 hour! 🐾";
      content = `
        <h2>Telemedicine Consultation Reminder</h2>
        <p>Hi ${context.customerName},</p>
        <p>This is a reminder that your scheduled veterinary consultation starts in exactly <strong>1 hour</strong>. Here are the details:</p>
        
        <div class="table-container">
          <table>
            <tbody>
              <tr>
                <td class="bold">Veterinarian</td>
                <td>Dr. ${context.vetName}</td>
              </tr>
              <tr>
                <td class="bold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="bold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="bold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p>Please log in, navigate to your appointments, and join the video consultation call room when it starts.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/customer" class="btn">Join Session</a>
        </div>
      `;
      break;

    case 'CONSULTATION_REMINDER_VET':
      subject = "Reminder: Patient Consultation starts in 1 hour! 🗓️";
      content = `
        <h2>Patient Appointment Reminder</h2>
        <p>Hello Dr. ${context.vetName},</p>
        <p>This is a reminder that your patient consultation starts in exactly <strong>1 hour</strong>. Here are the details:</p>
        
        <div class="table-container">
          <table>
            <tbody>
              <tr>
                <td class="bold">Client Name</td>
                <td>${context.customerName}</td>
              </tr>
              <tr>
                <td class="bold">Patient</td>
                <td>${context.animalName}</td>
              </tr>
              <tr>
                <td class="bold">Scheduled Time</td>
                <td>${context.scheduledTime}</td>
              </tr>
              <tr>
                <td class="bold">Session Mode</td>
                <td>${context.mode}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <p>Please make sure to set your status to available and log in to start the session on time.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/vet" class="btn">Open Vet Console</a>
        </div>
      `;
      break;

    case 'PROFILE_APPROVED':
      subject = "Your VetsBridge Profile is Approved! 🎉";
      content = `
        <h2>Application Approved!</h2>
        <p>Hello ${context.name},</p>
        <p>We are happy to inform you that your profile application as a <strong>${context.profileType}</strong> has been verified and approved by the administrators.</p>
        
        <p>All platform limitations have been lifted. You can now fully access the practitioner console, set schedules, list products, and interact in the public listings.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login" class="btn">Log In to Dashboard</a>
        </div>
      `;
      break;

    case 'PROFILE_REJECTED':
      subject = "Action Required: Profile Application Update ⚠️";
      content = `
        <h2>Application Update Required</h2>
        <p>Hello ${context.name},</p>
        <p>Your application for a <strong>${context.profileType}</strong> profile could not be verified by the administrators.</p>
        
        <p><strong>Reason for Rejection:</strong></p>
        <div class="feedback-box">
          "${context.rejectionReason}"
        </div>
        
        <p>Please log in to your dashboard, navigate to the Profile tab to review your documents and details, correct any verification issues, and resubmit your profile application for review.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login" class="btn">Update Profile Details</a>
        </div>
      `;
      break;

    case 'USER_PASSWORD_RESET':
      subject = "VetsBridge Account Password Reset 🔐";
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetLink = `${frontendUrl}/auth/reset-password?token=${context.token}`;
      content = `
        <h2>Password Reset Request</h2>
        <p>Hello ${context.name},</p>
        <p>A password reset request was received for your VetsBridge account. Please click the button below to set a new password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" class="btn" style="background-color: #ef4444; color: #ffffff !important;">Reset Your Password</a>
        </div>

        <p style="word-break: break-all; font-size: 13px; color: #64748b; margin-top: 20px;">
          Plaintext URL link:<br>
          <a href="${resetLink}" style="color: #4A90E2;">${resetLink}</a>
        </p>
        
        <p style="font-size: 14px; color: #475569; margin-top: 25px;">
          This password reset link expires in 30 minutes.
        </p>
        <p style="font-size: 14px; color: #475569; font-style: italic;">
          If you didn't request this password reset, you can safely ignore this email.
        </p>
      `;
      break;

    case 'USER_STATUS_CHANGED':
      subject = context.isActive ? "VetsBridge Account Re-activated! 🎉" : "VetsBridge Account Suspended ⚠️";
      content = context.isActive 
        ? `
            <h2>Account Re-activated</h2>
            <p>Hello ${context.name},</p>
            <p>Your VetsBridge account has been successfully reactivated. You now have full access to all your dashboard features again.</p>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login" class="btn">Go to Dashboard</a>
            </div>
          `
        : `
            <h2>Account Suspended</h2>
            <p>Hello ${context.name},</p>
            <p>Your VetsBridge account has been temporarily suspended by our administrative team.</p>
            
            <div class="feedback-box" style="border-left-color: #ef4444; background-color: #fef2f2; color: #991b1b;">
              <strong>Notice:</strong> Your access to all telemedicine, appointments, orders, and marketplace capabilities is currently paused.
            </div>
            
            <p>If you believe this was an error or wish to inquire about the compliance details, please contact administrative support at <a href="mailto:compliance@thevetsbridge.com" style="color: #4A90E2;">compliance@thevetsbridge.com</a>.</p>
          `;
      break;

    default:
      content = `<h2>Notification Update</h2><p>${JSON.stringify(context)}</p>`;
  }

  return {
    subject,
    html: baseLayout(content)
  };
}
