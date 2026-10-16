export type LoreEntry={id:string;kind:string;title:string;subtitle:string;body:string;status:'confirmed'|'demo'|'own';tags:string[];links:string[];source:string};
export type Actor={id:string;name:string;className:string;species:string;level:number;hp:number;maxHp:number;ac:number;speed:number;initiative:number;color:string;letter:string;x:number;y:number;conditions:string[];demo:boolean;sourceId?:string;note:string};
export type Scene={id:string;name:string;type:string;weather:string};
export type JournalEntry={id:string;title:string;body:string;date:string};
export type Campaign={id:string;name:string;ruleset:string;description:string;lore:LoreEntry[];actors:Actor[];scenes:Scene[];journal:JournalEntry[];favoriteSpells:string[];round:number;turn:number};
export type View='resumen'|'mesa'|'diario'|'codice'|'grupo'|'conjuros'|'clases'|'condiciones';
