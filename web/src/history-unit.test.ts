/**
 * A1+A2, client half — the transcript request must name the unit, and a unit change must refetch.
 *
 * There is no DOM here, so these assert the call site and the effect's dependencies. The behaviour (two
 * units showing different conversations) is measured in the browser and pasted in the report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const api = readFileSync(join(import.meta.dirname, "api.ts"), "utf8");
const lesson = readFileSync(join(import.meta.dirname, "components", "LessonPage.tsx"), "utf8");

test("the client sends the unit with the transcript request", () => {
  // The endpoint cannot scope without it, so an id-only call is the bug.
  assert.match(
    api,
    /fetchHistory = \(id: string, unit: number\)/,
    "fetchHistory must REQUIRE the unit — an optional one would silently reintroduce the shared transcript",
  );
  assert.match(api, /history\?unit=\$\{/, "and put it on the request");
});

test("the page passes the unit it is on, not a default", () => {
  assert.match(lesson, /fetchHistory\(courseId, unitNumber/, "the page must pass its own unit");
});

test("a unit change refetches — the unit is in the fetch effect's dependencies", () => {
  // The subtle half: without this, navigating between units keeps the first unit's transcript on screen and
  // only a full reload fixes it — which looks like the endpoint working and the page being stale.
  //
  // NOTE: an earlier version of this test scanned FORWARD from the call site for the first `}, [courseId…`
  // and found a DIFFERENT effect further down, so it passed while the fetch effect's deps were genuinely
  // reverted. It now finds the effect that CONTAINS the call, by scanning backwards for its `useEffect(`.
  const at = lesson.indexOf("fetchHistory(courseId, unitNumber");
  assert.ok(at > 0, "the call site must exist");
  const effectStart = lesson.lastIndexOf("useEffect(", at);
  assert.ok(effectStart > 0, "the call must be inside an effect");
  const effect = lesson.slice(effectStart, at + 2000);
  const deps = /}, \[([^\]]*)\]\);/g.exec(effect);
  assert.ok(deps, "the fetch effect must declare dependencies");
  assert.match(
    deps![1],
    /unitNumber/,
    `the fetch effect's own deps must include unitNumber, got [${deps![1]}]`,
  );
});
