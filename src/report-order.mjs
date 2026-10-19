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
/** Elapsed wall-clock time, including pauses and time between staff contributions.
 * @param {string|null|undefined} started
 * @param {string|null|undefined} finished
 * @returns {number|null}
 */
export function elapsedCheckSeconds(started,finished){
 if(!started||!finished)return null;
 const start=Date.parse(started),end=Date.parse(finished);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
 return Math.floor((end-start)/1000);
}
/** @param {string|null|undefined} started
 * @param {string|null|undefined} finished
 */
export function formatCheckDuration(started,finished){
 const total=elapsedCheckSeconds(started,finished);if(total===null)return '—';
 const hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),seconds=total%60;
 return `${hours?hours+'h ':''}${hours||minutes?minutes+'m ':''}${seconds}s`;
}
