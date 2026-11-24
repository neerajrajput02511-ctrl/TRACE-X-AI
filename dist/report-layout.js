const ink = '#142547';
const secondary = '#3e536d';
const blue = '#1c48ae';
const gray = '#d2dbea';

const stamp = value => Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
  : 'Not recorded';

export function assertReportReady(item) {
  const reviewed = item.review && item.review.revisionKey === (item.contentVersion || 0);
  if (!reviewed || !item.findings?.length) {
    throw Object.assign(new Error('The current report needs reviewer sign-off.'), {status:403});
  }
}

export function reportOptions(item) {
  return {
    size: 'A4',
    margin: 44,
    bufferPages: true,
    info: {Title:'TRACE-X AI • '+item.name, Author:'Team SHYNE', Subject:'Reviewed investigation findings'}
  };
}

export function writeReport(doc, item, {font, bold, devanagari}, {local = false} = {}) {
  const choose = (value, weight = font) => /[\u0900-\u097f]/u.test(value) ? devanagari : weight;
  const text = (value, options) => doc.font(choose(value)).fontSize(11.5).fillColor(ink).text(String(value), options);
  const heading = value => doc.moveDown(.75).font(bold).fontSize(17).fillColor(blue).text(value).moveDown(.25);
  doc.font(bold).fontSize(13).fillColor(blue).text('TRACE-X AI  /  TEAM SHYNE');
  doc.moveDown(.7).font(choose(item.name, bold)).fontSize(29).fillColor(ink).text(item.name);
  doc.moveDown(.35);
  text(item.id + '   •   Reviewed version ' + (item.contentVersion || 0) + (item.synthetic ? '   •   SYNTHETIC CASE' : ''));
  text('Investigator: ' + (item.owner || 'Not recorded'));
  text('Reviewer: ' + item.review.reviewer + '   •   ' + stamp(item.review.signedAt));
  text('Prepared: ' + stamp(new Date().toISOString()));
  if (local) text('Review recorded on this device. Reviewer identity was self-entered.');
  const details = item.metadata || {};
  if (details.scopeStart || details.scopeEnd) text('Case period: ' + (details.scopeStart || 'Unspecified') + ' to ' + (details.scopeEnd || 'Unspecified'));
  if (details.summary) text(details.summary);

  const records = new Map(item.records.map(record => [record.id, record]));
  const files = new Map(item.files.map(file => [file.id, file]));
  const includedFiles = new Set();
  heading('Reviewed findings');
  for (const finding of item.findings) {
    doc.font(choose(finding.title, bold)).fontSize(13).fillColor(ink).text(finding.title);
    text(finding.text);
    for (const id of new Set(finding.ids)) {
      const record = records.get(id);
      if (!record) continue;
      const locators = record.refs.map(ref => {
        const file = files.get(ref.fileId);
        const sheet = ref.sheet || file?.sheet;
        includedFiles.add(ref.fileId);
        return (file?.name || ref.fileId) + (sheet ? ' / ' + sheet : '') + ' / row ' + ref.line;
      });
      text(id + ' • ' + stamp(record.time) + ' • ' + locators.join(' | '), {indent:10});
      if (record.kind === 'IPDR' && (!record.port || !record.protocol)) {
        const missing = [!record.port && 'source port', !record.protocol && 'protocol'].filter(Boolean).join(' and ');
        text('Data quality: missing ' + missing + '. Subscriber attribution may be ambiguous.', {indent:10});
      }
    }
    doc.moveDown(.65);
  }
  heading('Original source fingerprints');
  for (const id of includedFiles) {
    const file = files.get(id);
    if (!file) continue;
    text(file.name + ' • ' + file.type);
    text('SHA-256   ' + file.sha256);
    text(file.qa.accepted + ' accepted • ' + file.qa.duplicate + ' duplicate • ' + file.qa.rejected + ' rejected');
    doc.moveDown(.4);
  }

  heading('Activity summary');
  const events = [...(item.audit || []), ...(item.activity || [])].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  text(events.length + ' recorded events • most recent 12 shown');
  for (const event of events.slice(-12)) text(stamp(event.time) + ' • ' + event.action + ' • ' + (event.actor || 'Workspace'));
  heading('Interpretation limits');
  text('Findings describe the supplied records. Tower observations represent network coverage areas. A shared IP or device identifier can have multiple explanations. A hash records file integrity against the recorded digest.');

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    const y = doc.page.height - 34;
    doc.strokeColor(gray).moveTo(44, y - 7).lineTo(doc.page.width - 44, y - 7).stroke();
    doc.font(font).fontSize(9).fillColor(secondary).text('TRACE-X AI  /  ' + item.id + '  /  ' + (index + 1) + ' of ' + pages.count, 44, y, {lineBreak:false});
  }
}
