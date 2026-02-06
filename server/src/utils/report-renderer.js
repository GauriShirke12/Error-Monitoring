const fs = require('fs');
const path = require('path');
let PDFDocument;
try {
  // eslint-disable-next-line global-require
  PDFDocument = require('pdfkit');
} catch (error) {
  PDFDocument = null;
}
let ExcelJS;
try {
  // eslint-disable-next-line global-require
  ExcelJS = require('exceljs');
} catch (error) {
  ExcelJS = null;
}
const logger = require('./logger');

const ensureDirectory = async (targetPath) => {
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });
};

const formatDuration = (milliseconds) => {
  if (!milliseconds || Number.isNaN(milliseconds)) {
    return '—';
  }
  const value = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(value / (60 * 1000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (remainingMinutes > 0) {
    return `${remainingMinutes}m`;
  }
  return '<1m';
};

const renderReportToPdf = async (filePath, payload) => {
  await ensureDirectory(filePath);

  if (!PDFDocument) {
    const placeholder = [
      'PDF rendering unavailable: pdfkit dependency not installed.',
      `Generated: ${new Date(payload.generatedAt || Date.now()).toUTCString()}`,
      `Project: ${payload.project?.name || 'Unknown project'}`,
      '',
      JSON.stringify(payload, null, 2),
    ].join('\n');
    await fs.promises.writeFile(filePath, placeholder, 'utf8');
    logger.warn({ filePath }, 'PDFKit dependency missing – wrote placeholder report payload');
    return;
  }

  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(20).fillColor('#111111').text(`${payload.project.name} • Incident Report`, { continued: false });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#555555').text(`Generated: ${new Date(payload.generatedAt).toUTCString()}`);
  doc.fontSize(12).fillColor('#555555').text(`Range: ${payload.range.label}`);
  if (payload.environmentLabel) {
    doc.fontSize(12).fillColor('#555555').text(`Environment: ${payload.environmentLabel}`);
  }

  doc.moveDown();
  doc.fontSize(14).fillColor('#222222').text('Key Metrics');
  doc.moveDown(0.5);

  const metrics = [
    ['Total Errors', (payload.metrics.totalErrors || 0).toLocaleString()],
    ['Active Errors', (payload.metrics.activeErrors || 0).toLocaleString()],
    ['Resolved Errors', (payload.metrics.resolvedErrors || 0).toLocaleString()],
    ['New Errors', (payload.metrics.newErrors || 0).toLocaleString()],
    ['Unresolved Backlog', (payload.metrics.unresolvedCount || 0).toLocaleString()],
    ['Avg Time To Resolve', formatDuration(payload.metrics.avgResolutionTimeMs)],
  ];

  metrics.forEach(([label, value]) => {
    doc.fontSize(11).fillColor('#333333').text(`${label}: ${value}`);
  });

  if (Array.isArray(payload.recommendations) && payload.recommendations.length) {
    doc.moveDown();
    doc.fontSize(14).fillColor('#222222').text('Recommendations');
    doc.moveDown(0.5);
    payload.recommendations.forEach((item, index) => {
      doc.fontSize(11).fillColor('#333333').text(`${index + 1}. ${item}`);
    });
  }

  if (Array.isArray(payload.topErrors) && payload.topErrors.length) {
    doc.addPage();
    doc.fontSize(14).fillColor('#222222').text('Top Error Patterns');
    doc.moveDown(0.75);

    payload.topErrors.slice(0, 10).forEach((entry, index) => {
      doc.fontSize(12).fillColor('#111111').text(`${index + 1}. ${entry.message}`);
      doc.fontSize(10).fillColor('#555555').text(`Occurrences: ${entry.count.toLocaleString()} • Environment: ${entry.environment}`);
      doc.moveDown(0.5);
    });
  }

  if (Array.isArray(payload.trends) && payload.trends.length) {
    doc.addPage();
    doc.fontSize(14).fillColor('#222222').text('Trend Snapshot');
    doc.moveDown(0.75);

    payload.trends.forEach((point) => {
      const label = point.label ?? point.bucketStart;
      const count = point.count ?? 0;
      const users = point.uniqueUsers ?? 0;
      doc.fontSize(10).fillColor('#444444').text(`${label} — ${count.toLocaleString()} occurrences, ${users.toLocaleString()} users`);
    });
  }

  if (payload.userImpact?.segments?.length) {
    doc.addPage();
    doc.fontSize(14).fillColor('#222222').text('User Impact Breakdown');
    doc.moveDown(0.75);

    payload.userImpact.segments.forEach((segment) => {
      doc.fontSize(11).fillColor('#333333').text(`${segment.label}: ${segment.count.toLocaleString()} occurrences`);
    });
  }

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
};

const renderReportToXlsx = async (filePath, payload) => {
  await ensureDirectory(filePath);

  if (!ExcelJS) {
    const placeholder = [
      'Excel report generation unavailable: exceljs dependency not installed.',
      `Generated: ${new Date(payload.generatedAt || Date.now()).toUTCString()}`,
      `Project: ${payload.project?.name || 'Unknown project'}`,
      '',
      JSON.stringify(payload, null, 2),
    ].join('\n');
    await fs.promises.writeFile(filePath, placeholder, 'utf8');
    logger.warn({ filePath }, 'ExcelJS dependency missing – wrote placeholder report payload');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Error Monitor';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  summarySheet.addRow(['Project', payload.project.name]);
  summarySheet.addRow(['Generated', new Date(payload.generatedAt).toUTCString()]);
  summarySheet.addRow(['Range', payload.range.label]);
  summarySheet.addRow(['Environment', payload.environmentLabel || 'All']);
  summarySheet.addRow([]);
  summarySheet.addRow(['Total Errors', payload.metrics.totalErrors || 0]);
  summarySheet.addRow(['Active Errors', payload.metrics.activeErrors || 0]);
  summarySheet.addRow(['Resolved Errors', payload.metrics.resolvedErrors || 0]);
  summarySheet.addRow(['New Errors', payload.metrics.newErrors || 0]);
  summarySheet.addRow(['Unresolved Backlog', payload.metrics.unresolvedCount || 0]);
  summarySheet.addRow(['Avg Time To Resolve (ms)', Math.round(payload.metrics.avgResolutionTimeMs || 0)]);

  if (Array.isArray(payload.recommendations) && payload.recommendations.length) {
    summarySheet.addRow([]);
    summarySheet.addRow(['Recommendations']);
    payload.recommendations.forEach((item, index) => {
      summarySheet.addRow([`${index + 1}. ${item}`]);
    });
  }

  if (Array.isArray(payload.topErrors) && payload.topErrors.length) {
    const topSheet = workbook.addWorksheet('Top Errors');
    topSheet.columns = [
      { header: '#', key: 'rank', width: 6 },
      { header: 'Message', key: 'message', width: 80 },
      { header: 'Environment', key: 'environment', width: 16 },
      { header: 'Occurrences', key: 'count', width: 16 },
    ];

    payload.topErrors.slice(0, 100).forEach((entry, index) => {
      topSheet.addRow({
        rank: index + 1,
        message: entry.message,
        environment: entry.environment,
        count: entry.count,
      });
    });
  }

  if (Array.isArray(payload.trends) && payload.trends.length) {
    const trendSheet = workbook.addWorksheet('Trend');
    trendSheet.columns = [
      { header: 'Bucket Start', key: 'bucketStart', width: 28 },
      { header: 'Label', key: 'label', width: 28 },
      { header: 'Occurrences', key: 'count', width: 16 },
      { header: 'Unique Users', key: 'users', width: 16 },
    ];

    payload.trends.forEach((point) => {
      trendSheet.addRow({
        bucketStart: point.bucketStart,
        label: point.label ?? '',
        count: point.count ?? 0,
        users: point.uniqueUsers ?? 0,
      });
    });
  }

  if (payload.userImpact?.segments?.length) {
    const impactSheet = workbook.addWorksheet('User Impact');
    impactSheet.columns = [
      { header: 'Segment', key: 'label', width: 36 },
      { header: 'Occurrences', key: 'count', width: 16 },
      { header: 'Unique Users', key: 'users', width: 16 },
    ];

    payload.userImpact.segments.forEach((segment) => {
      impactSheet.addRow({
        label: segment.label,
        count: segment.count ?? 0,
        users: segment.uniqueUsers ?? 0,
      });
    });
  }

  await workbook.xlsx.writeFile(filePath);
};

module.exports = {
  renderReportToPdf,
  renderReportToXlsx,
};
