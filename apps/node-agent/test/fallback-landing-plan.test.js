import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FALLBACK_LANDING_TEMPLATE_REF,
  createFallbackLandingPlan,
  validateFallbackLandingPlan
} from "../src/fallback-landing-plan.js";

test("creates enabled fallback landing plan with default template", () => {
  const plan = createFallbackLandingPlan({
    id: "landing-ams-1",
    nodeId: "ams-1"
  });

  assert.equal(validateFallbackLandingPlan(plan).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), {
    modelVersion: "lumen.node-agent.fallback-landing.v1",
    id: "landing-ams-1",
    nodeId: "ams-1",
    status: "enabled",
    templateRef: DEFAULT_FALLBACK_LANDING_TEMPLATE_REF,
    staticRoot: null,
    inlineHtml: null,
    metadata: {}
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.metadata), true);
});

test("creates custom static landing plan and supports disabled status", () => {
  const plan = createFallbackLandingPlan({
    id: "landing-custom",
    nodeId: "ams-1",
    status: "disabled",
    templateRef: null,
    staticRoot: "/srv/lumen/landing",
    metadata: { owner: "node-agent" }
  });

  assert.equal(plan.status, "disabled");
  assert.equal(plan.templateRef, null);
  assert.equal(plan.staticRoot, "/srv/lumen/landing");
  assert.deepEqual(plan.metadata, { owner: "node-agent" });
  assert.equal(validateFallbackLandingPlan(plan).ok, true);
});

test("creates custom templateRef landing plan", () => {
  const plan = createFallbackLandingPlan({
    id: "landing-template",
    nodeId: "ams-1",
    templateRef: "file://templates/quiet-landing"
  });

  assert.equal(plan.templateRef, "file://templates/quiet-landing");
  assert.equal(plan.staticRoot, null);
  assert.equal(validateFallbackLandingPlan(plan).ok, true);
});

test("rejects inline html with script tags", () => {
  assert.throws(
    () => createFallbackLandingPlan({
      id: "landing-script",
      nodeId: "ams-1",
      inlineHtml: "<main>offline</main><script>alert('x')</script>"
    }),
    /inlineHtml must not contain <script> tags/
  );
});

test("rejects inline secret-like fields", () => {
  assert.throws(
    () => createFallbackLandingPlan({
      id: "landing-secret",
      nodeId: "ams-1",
      metadata: { token: "do-not-store" }
    }),
    /Inline secret-like fields/
  );
});
