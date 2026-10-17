import { describe, expect, it } from "vitest";

import {
  attemptGradedEmail,
  enrollmentConfirmedEmail,
  escapeHtml,
  paymentReceiptEmail,
  quizPublishedEmail,
} from "@/lib/notifications/templates";

const HOSTILE_TITLE = `<img src=x onerror=alert(1)> & "quotes" & 'apostrophes'`;

describe("escapeHtml", () => {
  it("escapes <, >, &, \", and '", () => {
    expect(escapeHtml(HOSTILE_TITLE)).toBe(
      "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot; &amp; &#39;apostrophes&#39;",
    );
  });

  it("leaves an ordinary string untouched", () => {
    expect(escapeHtml("Intro to Algebra")).toBe("Intro to Algebra");
  });
});

describe("enrollmentConfirmedEmail", () => {
  it("includes the course title in subject and body", () => {
    const { subject, html } = enrollmentConfirmedEmail({ courseTitle: "Intro to Algebra" });
    expect(subject).toContain("Intro to Algebra");
    expect(html).toContain("Intro to Algebra");
  });

  it("escapes a hostile course title in the HTML body", () => {
    const { html } = enrollmentConfirmedEmail({ courseTitle: HOSTILE_TITLE });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("paymentReceiptEmail", () => {
  it("formats the amount and includes the course title", () => {
    const { subject, html } = paymentReceiptEmail({
      courseTitle: "Paid Course",
      amountPaise: 49_900,
      currency: "INR",
    });
    expect(subject).toContain("Paid Course");
    expect(html).toContain("₹499");
  });
});

describe("quizPublishedEmail", () => {
  it("includes both the quiz and course titles", () => {
    const { subject, html } = quizPublishedEmail({
      courseTitle: "Intro to Algebra",
      quizTitle: "Chapter 1 Quiz",
    });
    expect(subject).toContain("Chapter 1 Quiz");
    expect(html).toContain("Intro to Algebra");
    expect(html).toContain("Chapter 1 Quiz");
  });

  it("escapes a hostile quiz title", () => {
    const { html } = quizPublishedEmail({
      courseTitle: "Course",
      quizTitle: HOSTILE_TITLE,
    });
    expect(html).not.toContain("<img");
  });
});

describe("attemptGradedEmail", () => {
  it("includes the score for a normally submitted attempt", () => {
    const { subject, html } = attemptGradedEmail({
      quizTitle: "Chapter 1 Quiz",
      score: 3,
      maxScore: 5,
      status: "submitted",
    });
    expect(subject).toContain("Chapter 1 Quiz");
    expect(html).toContain("3 / 5");
    expect(html).not.toContain("Time ran out");
  });

  it("notes a timed-out attempt", () => {
    const { html } = attemptGradedEmail({
      quizTitle: "Chapter 1 Quiz",
      score: 1,
      maxScore: 5,
      status: "timed_out",
    });
    expect(html).toContain("Time ran out");
  });
});
