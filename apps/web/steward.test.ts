import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, relationships } from './src/steward/data';

test('fixture positions reconcile to NAV and 100% allocation', () => {
  assert.equal(fixture.positions.reduce((s,p)=>s+p.amount,0), fixture.nav);
  assert.equal(fixture.positions.reduce((s,p)=>s+p.share,0), 100);
  fixture.positions.forEach(p=>assert.equal(p.amount/fixture.nav*100,p.share));
});
test('scenario values follow stated price and liquidity shocks', () => {
  for(const scenario of fixture.scenarios) {
    assert.equal(scenario.collateral,6_000_000*(1-scenario.shock/100));
    assert.equal(scenario.ltv,Number((4_500_000/scenario.collateral*100).toFixed(2)));
    assert.equal(scenario.capacity,Math.round(1_400_000*(1-scenario.liquidity/100)));
    assert.equal(scenario.breach,scenario.ltv>86);
  }
});
test('plan decisions reconcile to the illustrative mandate', () => {
  for(const plan of fixture.plans) {
    assert.equal(plan.residual,Number(((3_840_000-plan.move)/fixture.nav*100).toFixed(1)));
    assert.equal(plan.idle,Number(((1_000_000+plan.move)/fixture.nav*100).toFixed(1)));
    assert.equal(plan.allowed,plan.residual<30&&plan.move/fixture.nav<=.15);
  }
});
test('map relationships have source references and shared convergence', () => {
  assert.ok(relationships.filter(r=>r.venue==='Morpho').length>=5);
  assert.ok(relationships.some(r=>r.supported));
  for(const r of relationships){assert.equal(new URL(r.source).protocol,'https:');assert.ok(r.note.length>30);}
});
