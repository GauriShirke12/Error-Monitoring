const buildEmailConfig = () => {
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  const defaultFrom = process.env.EMAIL_FROM || 'alerts@example.com';
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://app.example.com';
  const unsubscribeBaseUrl = process.env.EMAIL_UNSUBSCRIBE_URL || `${dashboardUrl.replace(/\/?$/, '')}/settings/alerts/unsubscribe`;

  if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
    return {
      provider: 'sendgrid',
      from: defaultFrom,
      dashboardUrl,
      unsubscribeBaseUrl,
      transport: {
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY,
        },
      },
    };
  }

  if ((provider === 'gmail' || provider === 'smtp') && process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASS) {
    return {
      provider: provider === 'gmail' ? 'gmail' : 'smtp',
      from: defaultFrom,
      dashboardUrl,
      unsubscribeBaseUrl,
      transport: {
        host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.EMAIL_SMTP_PORT || (provider === 'gmail' ? 465 : 587)),
        secure: process.env.EMAIL_SMTP_SECURE === 'true' || provider === 'gmail',
        auth: {
          user: process.env.EMAIL_SMTP_USER,
          pass: process.env.EMAIL_SMTP_PASS,
        },
      },
    };
  }

  return {
    provider: 'stub',
    from: defaultFrom,
    dashboardUrl,
    unsubscribeBaseUrl,
    transport: {
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    },
  };
};

module.exports = {
  getEmailConfig: buildEmailConfig,
};
