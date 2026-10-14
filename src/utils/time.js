const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});
function displayTime(date) {
  if (!date) return null;
  const parts = Object.fromEntries(formatter.formatToParts(new Date(date)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function isoTime(date) {return date ? new Date(date).toISOString() : null;}
module.exports = {displayTime, isoTime};
