import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cacheIssue, issueSection, pullRequestStatus } from '../scripts/github-workflow.mjs';

function fixture(t: TestContext) {
  mkdirSync('.tools/tests',{recursive:true});
  const root=mkdtempSync(resolve('.tools/tests/github-tools-'));
  t.after(()=>rmSync(root,{recursive:true,force:true})); return root;
}
const head='a'.repeat(40);
type Comment = { databaseId:number; author:{login:string}; body:string; createdAt:string };
type Pr = {
  headRefOid:string; state:string; mergeable:string;
  commits:{nodes:{commit:{statusCheckRollup:null | {contexts:{pageInfo:{hasNextPage:boolean};nodes:{__typename:string;name:string;status:string;conclusion:string}[]}}}}[]};
  reviews:{pageInfo:{hasPreviousPage:boolean};nodes:unknown[]};
  comments:{pageInfo:{hasPreviousPage:boolean};nodes:Comment[]};
  reviewThreads:{pageInfo:{hasNextPage:boolean};nodes:{isResolved:boolean;isOutdated:boolean;comments:{pageInfo:{hasNextPage:boolean};nodes:{body:string;path:string;author:{login:string}}[]}}[]};
};
function pr(): Pr {
  return {headRefOid:head,state:'OPEN',mergeable:'MERGEABLE',
    commits:{nodes:[{commit:{statusCheckRollup:{contexts:{pageInfo:{hasNextPage:false},nodes:[{__typename:'CheckRun',name:'Quality',status:'COMPLETED',conclusion:'SUCCESS'}]}}}}]},
    reviews:{pageInfo:{hasPreviousPage:false},nodes:[]},comments:{pageInfo:{hasPreviousPage:false},nodes:[]},
    reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]}};
}
test('large Japanese issue is fetched once, cached intact and read by section; failed refresh preserves it',t=>{
  const root=fixture(t),repo='fixture/project'; let calls=0;
  const body='# Spec\n## Storage\n'+ '原本保持\n'.repeat(15000)+'```text\n## Fake heading\n```\n### Failure\nEACCES\n## UI\n表示\n';
  const fetchJson=()=>{calls++;return {number:14,html_url:`https://github.com/${repo}/issues/14`,updated_at:'2026-10-20T00:00:00Z',body};};
  const first=cacheIssue({root,repo,number:14,fetchJson});
  assert.equal(first.body,body); assert.equal(first.cached,false);
  const second=cacheIssue({root,repo,number:14,fetchJson}); assert.equal(second.cached,true); assert.equal(calls,1);
  assert.equal(issueSection(second.body,'UI'),'## UI\n表示\n');
  assert.doesNotMatch(issueSection(second.body),/Fake heading/);
  assert.match(issueSection(second.body,'Storage'),/### Failure\nEACCES/);
  assert.throws(()=>issueSection(second.body,'Missing'));
  const file=join(root,'.tools/issues/fixture--project/14.json'),saved=readFileSync(file,'utf8');
  assert.throws(()=>cacheIssue({root,repo,number:14,refresh:true,fetchJson:()=>{throw Error('offline');}}),/offline/);
  assert.equal(readFileSync(file,'utf8'),saved);
  assert.throws(()=>cacheIssue({root,repo,number:14,refresh:true,fetchJson:()=>({number:15})}),/invalid/);
  assert.equal(readFileSync(file,'utf8'),saved);
  writeFileSync(file,saved.replace('原本保持','改ざん'));
  assert.throws(()=>cacheIssue({root,repo,number:14,fetchJson}),/cache is invalid/);
});

test('PR polling summarizes changes, detects edited feedback, refuses other heads and incomplete success',t=>{
  const root=fixture(t); let value=pr(),calls=0;
  const options={root,repo:'fixture/project',number:4,head,fetchJson:()=>{calls++;return {data:{repository:{pullRequest:value}}};}};
  const first=pullRequestStatus(options); assert.equal(first.changed,true); assert.equal(first.checksPassed,true);
  const same=pullRequestStatus(options); assert.equal(same.changed,false); assert.equal('reviews' in same,false);
  value.comments.nodes.push({databaseId:1,author:{login:'reviewer'},body:'checking',createdAt:'now'});
  assert.equal(pullRequestStatus(options).changed,true);
  value.comments.nodes[0].body='new finding';
  assert.equal(pullRequestStatus(options).changed,true);
  const detailed=pullRequestStatus({...options,details:true}); assert.ok(detailed.feedback); assert.equal(detailed.feedback.comments.nodes[0].body,'new finding');
  value.reviewThreads.nodes.push({isResolved:false,isOutdated:true,comments:{pageInfo:{hasNextPage:false},nodes:[]}});
  assert.equal(pullRequestStatus(options).unresolvedThreads,1);
  assert.ok(value.commits.nodes[0].commit.statusCheckRollup);
  value.commits.nodes[0].commit.statusCheckRollup.contexts.pageInfo.hasNextPage=true;
  const partial=pullRequestStatus(options); assert.equal(partial.truncated,true); assert.equal(partial.checksPassed,false);
  value=pr(); value.commits.nodes[0].commit.statusCheckRollup=null;
  assert.equal(pullRequestStatus(options).checksPassed,false);
  value=pr(); value.headRefOid='b'.repeat(40);
  assert.throws(()=>pullRequestStatus(options),/head changed/);
  assert.throws(()=>pullRequestStatus({...options,head:'short'}),/full --head/);
  assert.equal(calls,9);
});

test('PR details retain original findings with replies, detect edits and reject truncated thread conversations',t=>{
  const root=fixture(t), value=pr();
  value.reviewThreads.nodes.push({isResolved:false,isOutdated:false,comments:{pageInfo:{hasNextPage:false},nodes:[
    {body:'original finding',path:'src/example.ts',author:{login:'reviewer'}},
    {body:'author reply',path:'src/example.ts',author:{login:'author'}}
  ]}});
  const options={root,repo:'fixture/project',number:4,head,fetchJson:(args:string[])=>{
    const returned=structuredClone(value);
    // Simulate the GraphQL connection selection so last:1 really omits the finding.
    if (args.some(arg=>arg.includes('comments(last:1)'))) {
      returned.reviewThreads.nodes[0].comments.nodes=returned.reviewThreads.nodes[0].comments.nodes.slice(-1);
    }
    return {data:{repository:{pullRequest:returned}}};
  }};
  const detail=pullRequestStatus({...options,details:true}); assert.ok(detail.feedback);
  assert.deepEqual(detail.feedback.threads.nodes[0].comments.nodes.map((c:{body:string})=>c.body),['original finding','author reply']);
  assert.equal(pullRequestStatus(options).changed,false);
  value.reviewThreads.nodes[0].comments.nodes[0].body='edited original finding';
  assert.equal(pullRequestStatus(options).changed,true);
  value.reviewThreads.nodes[0].comments.pageInfo.hasNextPage=true;
  const truncated=pullRequestStatus({...options,details:true});
  assert.equal(truncated.truncated,true); assert.equal(truncated.checksPassed,false);
});

test('spec headings stay inside fences until a matching delimiter with whitespace-only suffix',()=>{
  for (const marker of ['```','~~~']) {
    const body=`# Spec\n${marker}text\n${marker}not-a-closing-fence\n## Fake heading\n${marker.slice(0,2)}\n${marker} \t\r\n## Real heading\ncontract\n`;
    assert.doesNotMatch(issueSection(body),/Fake heading/);
    assert.equal(issueSection(body,'Real heading'),'## Real heading\ncontract\n');
  }
});
