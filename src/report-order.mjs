/**
 * Keep issue groups together without changing saved check positions.
 * @template {{status: string|null, position: number}} T
 * @param {T[]} lines
 * @returns {T[]}
 */
export function groupReportLines(lines) {
 const order = new Map([['out_of_date',0],['not_stickered',1],['rotation_issue',2],['okay',3]]);
 return [...lines].sort((a,b)=>(order.get(a.status??'')??4)-(order.get(b.status??'')??4)||a.position-b.position);
}
