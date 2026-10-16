export type Risk='high'|'normal'|'low';
export type Product={id:string;name:string;ean:string;plu:string;section:string;risk:Risk};
export type Member={id:string;name:string;username:string;role:string;active:number;store_id:string|null;store_number:string|null;is_owner:boolean};
export type Line=Product&{position:number;verified_at:string|null;method:string;status:string|null;quantity:number;saved_at:string|null;verified_by:string|null;recorded_by:string|null;recorded_by_name?:string;revision:number};
export type Round={id:string;date:string;mode:string;store:string;store_id:string;store_number?:string;finished_by?:string;started:string;finished:string|null;user_id?:string;user_name?:string;total?:number;checked?:number;out_of_date?:number;not_stickered?:number;rotation_issue?:number;off_sale?:number};
export type Store={id:string;number:string|null;name:string};
export type State={member:Member;store:Store|null;sharedCheck:{roundId:string|null;completed:boolean;reportDeleted:boolean}|null;date:string;products:Product[];round:Round|null;lines:Line[];selection:Product[]|null;selectionCounts:Record<string,number>|null;riskWeights:Record<Risk,number>};
