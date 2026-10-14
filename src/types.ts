export type Risk='high'|'normal'|'low';
export type Product={id:string;name:string;ean:string;plu:string;section:string;risk:Risk};
export type Member={id:string;name:string;username:string;role:string;active:number};
export type Line=Product&{position:number;verified_at:string|null;method:string;status:string|null;quantity:number;saved_at:string|null};
export type Round={id:string;date:string;mode:string;store:string;started:string;finished:string|null;user_id?:string;user_name?:string;total?:number;checked?:number;out_of_date?:number;not_stickered?:number;rotation_issue?:number;off_sale?:number};
export type State={member:Member;date:string;products:Product[];round:Round|null;lines:Line[];selection:Product[]|null;riskWeights:Record<Risk,number>};
