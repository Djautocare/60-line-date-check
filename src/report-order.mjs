/**
 * Keep issue groups together without changing saved check positions.
 * @template {{status: string|null, position: number}} T
 * @param {T[]} lines
 * @returns {T[]}
 */
export function groupReportLines(lines) {
 const order = new Map([['out_of_date',0],['not_stickered',1],['rotation_issue',2],['okay',3],['off_sale',4]]);
 return [...lines].sort((a,b)=>(order.get(a.status??'')??5)-(order.get(b.status??'')??5)||a.position-b.position);
}
/** Show the saved result time in the store's UK timezone.
 * @param {string|null|undefined} timestamp
 */
export function formatCheckTime(timestamp){
 if(!timestamp||!Number.isFinite(Date.parse(timestamp)))return '—';
 return new Date(timestamp).toLocaleString('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
}
