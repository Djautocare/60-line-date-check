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
