import {create} from 'zustand';
import {persist,createJSONStorage} from 'zustand/middleware';
import {initialCampaign} from './data';
import type {Campaign,Actor,LoreEntry,JournalEntry} from '../shared/types';
type State={campaigns:Campaign[];activeId:string;select:(id:string)=>void;update:(fn:(c:Campaign)=>Campaign)=>void;addCampaign:(name:string)=>void;updateActor:(id:string,patch:Partial<Actor>)=>void;saveLore:(entry:LoreEntry)=>void;saveJournal:(entry:JournalEntry)=>void;toggleSpell:(id:string)=>void};
export const useStore=create<State>()(persist((set,get)=>({
 campaigns:[structuredClone(initialCampaign)],activeId:'luz',
 select:activeId=>set({activeId}),
 update:fn=>set(s=>({campaigns:s.campaigns.map(c=>c.id===s.activeId?fn(c):c)})),
 addCampaign:name=>{const id=crypto.randomUUID();set(s=>({campaigns:[...s.campaigns,{id,name,ruleset:'dnd5e-2014',description:'Una nueva historia empieza alrededor de la mesa.',lore:[],actors:[],scenes:[],journal:[],favoriteSpells:[],round:1,turn:0}],activeId:id}));},
 updateActor:(id,patch)=>get().update(c=>({...c,actors:c.actors.map(a=>a.id===id?{...a,...patch}:a)})),
 saveLore:entry=>get().update(c=>({...c,lore:c.lore.some(e=>e.id===entry.id)?c.lore.map(e=>e.id===entry.id?entry:e):[...c.lore,entry]})),
 saveJournal:entry=>get().update(c=>({...c,journal:[entry,...c.journal]})),
 toggleSpell:id=>get().update(c=>({...c,favoriteSpells:c.favoriteSpells.includes(id)?c.favoriteSpells.filter(x=>x!==id):[...c.favoriteSpells,id]}))
}),{name:'umbra-campaigns-v1',version:1,storage:createJSONStorage(()=>localStorage),partialize:s=>({campaigns:s.campaigns,activeId:s.activeId})}));
export const fold=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
