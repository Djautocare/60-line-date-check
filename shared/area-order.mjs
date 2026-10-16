export const CHECK_AREA_ORDER=Object.freeze(['Bread','Ambient produce','Chilled produce','Short life','Long life']);
const ranks=new Map(CHECK_AREA_ORDER.map((area,index)=>[area.toLowerCase(),index]));
/** Group areas without changing the chosen products or their order within each area.
 * @template {{section:string}} T
 * @param {T[]} products
 * @returns {T[]}
 */
export function orderByArea(products){
 const area=p=>p.section.trim().toLowerCase();
 return [...products].sort((a,b)=>(ranks.get(area(a))??5)-(ranks.get(area(b))??5)||area(a).localeCompare(area(b)));
}
