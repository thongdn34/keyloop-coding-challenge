import {describe,expect,it} from '@jest/globals';
import {overlaps} from './scheduler.service';
describe('booking overlap',()=>{const d=(h:number)=>new Date('2026-11-01T'+String(h).padStart(2,'0')+':00:00Z');it('detects overlap',()=>expect(overlaps(d(10),d(12),d(11),d(13))).toBe(true));it('permits adjacent slots',()=>expect(overlaps(d(10),d(11),d(11),d(12))).toBe(false));});
