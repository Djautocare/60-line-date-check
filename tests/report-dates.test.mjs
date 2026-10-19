import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validDate,reportRange,nextDate} from '../shared/report-dates.mjs';
test('report date validation rejects impossible dates and preserves leap days',()=>{
 assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-13-01'),false);assert.equal(validDate('2026-1-01'),false);assert.equal(nextDate('2026-12-31'),'2027-01-01');
});
test('report weeks span Monday through Sunday across year boundaries',()=>{
 assert.deepEqual(reportRange('week','2027-01-01','','2027-01-01'),{from:'2026-12-28',to:'2027-01-03'});
 assert.deepEqual(reportRange('week','2026-10-18','','2026-10-14'),{from:'2026-10-12',to:'2026-10-18'});
});
test('month and custom date filters include both endpoints',()=>{
 assert.deepEqual(reportRange('month','2024-02','','2026-10-14'),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(reportRange('date','2026-10-13','','2026-10-14'),{from:'2026-10-13',to:'2026-10-13'});
 assert.deepEqual(reportRange('range','2026-10-01','2026-10-14','2026-10-14'),{from:'2026-10-01',to:'2026-10-14'});
 assert.throws(()=>reportRange('range','2026-10-14','2026-10-01','2026-10-14'),/end date/);
});
test('relative periods include today and use calendar days through clock changes',()=>{
 assert.deepEqual(reportRange('period','last_7','','2026-10-27'),{from:'2026-10-21',to:'2026-10-27'});
 assert.deepEqual(reportRange('period','last_30','','2026-01-14'),{from:'2025-12-16',to:'2026-01-14'});
 assert.deepEqual(reportRange('period','this_year','','2026-10-14'),{from:'2026-01-01',to:'2026-10-14'});
 assert.deepEqual(reportRange('all','','','2026-10-14'),{});
});
test('per-product Checked at uses saved UK time, handles daylight saving and does not invent missing times',async()=>{
 const {formatCheckTime}=await import('../src/report-order.mjs');
 assert.equal(formatCheckTime('2026-10-16T08:36:54.000Z'),'16/10/2026, 09:36:54');
 assert.equal(formatCheckTime('2026-12-16T08:36:54.000Z'),'16/12/2026, 08:36:54');
 assert.equal(formatCheckTime('2026-07-01T23:15:09.000Z'),'02/07/2026, 00:15:09');
 for(const value of [null,undefined,'','not a time'])assert.equal(formatCheckTime(value),'—');
});
test('completion duration uses real elapsed seconds across midnight and daylight-saving changes',async()=>{
 const {elapsedCheckSeconds,formatCheckDuration}=await import('../src/report-order.mjs');
 assert.equal(elapsedCheckSeconds('2026-10-19T08:00:00Z','2026-10-19T08:12:34.999Z'),754);
 assert.equal(formatCheckDuration('2026-10-19T08:00:00Z','2026-10-19T08:12:34.999Z'),'12m 34s');
 assert.equal(formatCheckDuration('2026-10-19T23:50:00Z','2026-10-20T01:02:03Z'),'1h 12m 3s');
 assert.equal(formatCheckDuration('2026-10-25T01:45:00+01:00','2026-10-25T01:15:00+00:00'),'30m 0s');
 assert.equal(formatCheckDuration('2026-10-19T08:00:00Z','2026-10-20T09:00:00Z'),'25h 0m 0s');
 assert.equal(formatCheckDuration('2026-10-19T08:00:00Z','2026-10-19T08:00:00Z'),'0s');
 assert.equal(formatCheckDuration('2026-10-19T08:00:00Z','2026-10-19T08:00:09Z'),'9s');
});
test('unfinished, missing, invalid and reversed completion timestamps have no invented duration',async()=>{
 const {elapsedCheckSeconds,formatCheckDuration}=await import('../src/report-order.mjs');
 for(const [start,end] of [[null,null],['2026-10-19T08:00:00Z',null],[null,'2026-10-19T08:12:00Z'],['bad','2026-10-19T08:12:00Z'],['2026-10-19T08:00:00Z','bad'],['2026-10-19T08:12:00Z','2026-10-19T08:00:00Z']]){
  assert.equal(elapsedCheckSeconds(start,end),null);assert.equal(formatCheckDuration(start,end),'—');
 }
});
