const validateEnv = () => {
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (provider === 'sendgrid') {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid');
    }
  } else if (provider === 'gmail' || provider === 'smtp') {
    if (!process.env.EMAIL_SMTP_USER || !process.env.EMAIL_SMTP_PASS) {
      throw new Error('EMAIL_SMTP_USER and EMAIL_SMTP_PASS are required when EMAIL_PROVIDER is gmail or smtp');
    }
  }

  return true;
};

module.exports = { validateEnv };