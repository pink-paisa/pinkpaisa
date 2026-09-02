const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildResearchContext,
  buildWeeklyCandidateResearchFocus,
  collectExternalResearch,
  validateFocusedResearch,
  _private: researchPrivate,
} = require("../services/social/socialResearchService");
const { validatePublishableCopyIntegrity } = require("../services/social/socialContentIntegrity");
const { callStructuredResponse } = require("../services/social/openAiSocialProvider");
const { executeGenerationRun } = require("../services/social/socialManagerService");

const SIMPLE_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption"],
  properties: {
    caption: { type: "string", minLength: 1, maxLength: 2200 },
  },
};

function sipCandidate() {
  return {
    candidateId: "candidate_sip_basics",
    title: "SIP basics without jargon",
    topic: "SIP basics: mechanics, costs, and risks",
    objective: "EDUCATION",
    contentPillar: "Money Education",
    audienceSegment: "Indian women beginning to learn about mutual funds",
    whyThisWeek: "The approved plan calls for a foundational SIP explainer.",
  };
}

function pauseSipCandidate() {
  return {
    ...sipCandidate(),
    candidateId: "candidate_pause_sip",
    title: "Can you pause a SIP?",
    topic: "How to pause a SIP temporarily",
    whyThisWeek: "The approved plan specifically asks what pausing an SIP means and how it works.",
  };
}

function loanCandidate() {
  return {
    candidateId: "candidate_loan_cost_decoder",
    title: "Decode the complete cost of a personal loan",
    topic: "Loan costs: interest, EMI obligations, and default risks",
    objective: "EDUCATION",
    contentPillar: "Money Education",
    audienceSegment: "Indian women comparing a personal loan",
    whyThisWeek: "The approved plan calls for a plain-language borrowing-cost explainer.",
  };
}

function loanTopicCandidate(topic) {
  return {
    ...loanCandidate(),
    candidateId: `candidate_${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60)}`,
    title: topic,
    topic,
    whyThisWeek: `The approved plan specifically asks about ${topic}.`,
  };
}

function regulatedFinanceCandidate(topic) {
  return {
    candidateId: `candidate_${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60)}`,
    title: topic,
    topic,
    objective: "EDUCATION",
    contentPillar: "Money Education",
    audienceSegment: "Indian women checking a regulated financial product or rule",
    whyThisWeek: `The approved plan specifically asks about ${topic}.`,
  };
}

function researchSignal(overrides = {}) {
  return {
    headline: "Official SIP investor education",
    summary: "An official source explains systematic investment plans for investor education.",
    claimSupported: "A systematic investment plan uses regular investments. Mutual funds carry market risk and returns are not guaranteed.",
    sourceUrl: "https://www.sebi.gov.in/investor/sip-basics.html",
    sourceTitle: "SIP investor education",
    publisher: "Securities and Exchange Board of India",
    publishedAt: "2026-08-30T00:00:00.000Z",
    sourceType: "GOVERNMENT",
    confidence: 0.97,
    freshnessHours: 48,
    ...overrides,
  };
}

function openAiResearchResult(signals) {
  return {
    provider: "openai",
    model: "test-research-model",
    prompt_version: "social-research-v3",
    response_id: "research-response-1",
    attempt_count: 1,
    attempts: [{
      attempt: 1,
      status: "SUCCEEDED",
      response_id: "research-response-1",
      usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
    }],
    started_at: "2026-09-01T06:00:00.000Z",
    completed_at: "2026-09-01T06:00:01.000Z",
    input_fingerprint: "a".repeat(64),
    output_fingerprint: "b".repeat(64),
    usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
    web_sources: signals.map((signal) => ({ url: signal.sourceUrl, title: signal.sourceTitle })),
    output: { signals, unconfirmedTopics: [] },
  };
}

function mockResearchPages(pageTextByUrl) {
  return {
    researchPageLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    researchPageFetchImpl: async (url) => {
      const body = pageTextByUrl[url];
      if (body == null) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => "Not found",
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        headers: {
          get: (name) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
        },
        text: async () => body,
      };
    },
  };
}

function groundedEvidence(values) {
  return new Map(values.map((value, index) => [index, value]));
}

function standardSipPages() {
  return {
    "https://www.sebi.gov.in/investor/sip-basics.html": "<main><p>A systematic investment plan uses regular investments at fixed intervals.</p><p>Mutual funds carry market risk, returns may fluctuate, and returns are not guaranteed.</p><p>DO_NOT_STORE_RAW_PAGE_MARKER</p></main>",
    "https://www.amfiindia.com/investor/expenses": "<main><p>Mutual fund costs may include an expense ratio and an exit load where applicable.</p></main>",
  };
}

test("weekly SIP research is scoped to the approved topic and requires explicit authoritative claim coverage", async () => {
  const focus = buildWeeklyCandidateResearchFocus(sipCandidate());
  assert.equal(focus.topic_family, "SIP");
  assert.equal(focus.requires_authoritative_primary, true);
  assert.deepEqual(
    focus.required_claim_coverage.map((item) => item.key),
    ["mechanics", "costs_and_charges", "risks_and_limitations"],
  );

  const context = buildResearchContext({
    now: new Date("2026-09-01T06:00:00.000Z"),
    internalSignals: { summary: {}, priorities: [] },
    settings: { target_audience: ["Indian women"] },
    focus,
  });
  assert.equal(context.approved_weekly_candidate.topic, sipCandidate().topic);
  assert.match(context.task, /exact approved weekly topic/i);
  assert.deepEqual(context.required_claim_coverage, focus.required_claim_coverage);
  assert.ok(context.authoritative_primary_domains.includes("sebi.gov.in"));

  const sources = [
    {
      title: "SEBI SIP education",
      url: "https://www.sebi.gov.in/investor/sip-basics.html",
      domain: "sebi.gov.in",
      claim_supported: "Model-authored text is not evidence.",
    },
    {
      title: "AMFI cost explanation",
      url: "https://www.amfiindia.com/investor/expenses",
      domain: "amfiindia.com",
      claim_supported: "Model-authored text is not evidence.",
    },
  ];
  const validated = validateFocusedResearch({
    mode: "openai_web",
    sources,
  }, focus, {
    sourceEvidence: groundedEvidence([
      "A systematic investment plan uses regular investments. Mutual funds carry market risk and returns are not guaranteed.",
      "Mutual fund costs may include an expense ratio and an exit load where applicable.",
    ]),
  });
  assert.ok(validated.claim_coverage.every((item) => item.covered));
  assert.deepEqual(validated.authoritative_source_indexes, [0, 1]);
  assert.ok(validated.sources[0].claim_coverage.includes("mechanics"));
  assert.ok(validated.sources[1].claim_coverage.includes("costs_and_charges"));
});

test("authoritative keyword lists cannot masquerade as explained SIP claim coverage", () => {
  const focus = buildWeeklyCandidateResearchFocus(sipCandidate());
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{
        title: "Keyword-only page",
        url: "https://www.sebi.gov.in/investor/keywords.html",
        domain: "sebi.gov.in",
      }],
    }, focus, {
      sourceEvidence: groundedEvidence([
        "Systematic Investment Plan. Fees. Market risk. Mechanics. Costs. Risks.",
      ]),
    }),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.research_evidence.missing_claims.length === 3,
  );
});

test("weekly SIP research rejects adjacent participation statistics before copy or compliance", () => {
  const focus = buildWeeklyCandidateResearchFocus(sipCandidate());
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{
        title: "SIP account participation rises",
        url: "https://www.amfiindia.com/research/participation",
        domain: "amfiindia.com",
        claim_supported: "The number of SIP accounts increased during the month.",
      }],
    }, focus, {
      sourceEvidence: groundedEvidence(["The number of SIP accounts increased during the month."]),
    }),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.status === 422
      && error.transient === false
      && error.research_evidence.missing_claims.includes("costs_and_charges")
      && error.research_evidence.missing_claims.includes("risks_and_limitations"),
  );
});

test("a fabricated model claim attached to an authoritative URL cannot substitute for fetched page evidence", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const fabricated = [researchSignal({
      claimSupported: "A systematic investment plan uses regular investments; an expense ratio and exit load may apply; mutual funds carry market risk and returns are not guaranteed.",
    })];
    await assert.rejects(
      () => collectExternalResearch({
        settings: { research_provider: "openai_web", research_domains: ["sebi.gov.in"] },
        generationRequest: { weekly_candidate: sipCandidate() },
        dependencies: {
          ...mockResearchPages({
            "https://www.sebi.gov.in/investor/sip-basics.html": "<main><p>Investor education contact directory and office hours.</p></main>",
          }),
          openAiResearch: async () => openAiResearchResult(fabricated),
          collectRssResearch: async () => ({ signals: [], sources: [] }),
        },
      }),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.social_stage === "research"
        && error.response_id === "research-response-1"
        && error.usage.total_tokens === 50
        && error.research_evidence.missing_claims.length === 3,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("generic SIP-family evidence does not validate the exact approved topic of pausing a SIP", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const signals = [
      researchSignal({
        claimSupported: "You can pause a SIP. A systematic investment plan also uses regular investments and mutual funds carry market risk without guaranteed returns.",
      }),
      researchSignal({
        headline: "Official mutual-fund cost explanation",
        summary: "An official industry source explains common scheme costs.",
        claimSupported: "Mutual fund costs may include an expense ratio and an exit load where applicable.",
        sourceUrl: "https://www.amfiindia.com/investor/expenses",
        sourceTitle: "Understanding mutual-fund expenses",
        publisher: "Association of Mutual Funds in India",
        sourceType: "INDUSTRY",
      }),
    ];
    const focus = buildWeeklyCandidateResearchFocus(pauseSipCandidate());
    assert.deepEqual(
      focus.exact_topic_requirements.map((item) => item.key),
      ["sip_pause_availability", "sip_pause_process"],
    );
    await assert.rejects(
      () => collectExternalResearch({
        settings: {
          research_provider: "openai_web",
          research_domains: ["sebi.gov.in", "amfiindia.com"],
        },
        generationRequest: { weekly_candidate: pauseSipCandidate() },
        dependencies: {
          ...mockResearchPages(standardSipPages()),
          openAiResearch: async () => openAiResearchResult(signals),
          collectRssResearch: async () => ({ signals: [], sources: [] }),
        },
      }),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.social_stage === "research"
        && error.response_id === "research-response-1"
        && error.usage.total_tokens === 50
        && error.research_evidence.missing_claims.length === 0
        && error.research_evidence.missing_exact_topics.includes("sip_pause_availability")
        && error.research_evidence.missing_exact_topics.includes("sip_pause_process")
        && error.research_evidence.exact_topic_covered === false,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("weekly loan research requires authoritative coverage of cost, repayment, and risk", () => {
  const focus = buildWeeklyCandidateResearchFocus(loanCandidate());
  assert.equal(focus.topic_family, "LOAN");
  assert.deepEqual(
    focus.required_claim_coverage.map((item) => item.key),
    ["borrowing_costs", "repayment_obligations", "risks_and_limitations"],
  );

  const validated = validateFocusedResearch({
    mode: "openai_web",
    sources: [{
      title: "RBI borrower education",
      url: "https://www.rbi.org.in/commonperson/loan-costs.html",
      domain: "rbi.org.in",
      claim_supported: "Compare the interest rate, processing charges and total cost of borrowing. EMI repayment obligations continue through the agreed tenure; late payment or default may attract a penalty and affect credit history.",
    }],
  }, focus, {
    sourceEvidence: groundedEvidence([
      "Compare the interest rate, processing charges and total cost of borrowing. EMI repayment obligations continue through the agreed tenure; late payment or default may attract a penalty and affect credit history.",
    ]),
  });
  assert.ok(validated.claim_coverage.every((item) => item.covered));
  assert.deepEqual(validated.authoritative_source_indexes, [0]);
});

test("loan-family evidence cannot substitute for exact prepayment, foreclosure, rate-type, or hidden-charge evidence", () => {
  const genericLoanEvidence = "A personal loan may include interest and processing charges. EMI repayment continues through the tenure, while late payment or default may attract a penalty and affect credit history.";
  const cases = [
    {
      topic: "Loan prepayment and foreclosure rules",
      missing: ["loan_prepayment_availability", "loan_prepayment_terms", "loan_foreclosure"],
    },
    {
      topic: "Fixed rate versus floating rate personal loans",
      missing: ["loan_floating_rate", "loan_fixed_rate"],
    },
    {
      topic: "Hidden charges in a personal loan",
      missing: ["loan_hidden_charges"],
    },
  ];
  for (const row of cases) {
    const focus = buildWeeklyCandidateResearchFocus(loanTopicCandidate(row.topic));
    assert.deepEqual(focus.exact_topic_requirements.map((item) => item.key), row.missing);
    assert.throws(
      () => validateFocusedResearch({
        mode: "openai_web",
        sources: [{
          title: "Generic RBI borrower education",
          url: "https://www.rbi.org.in/commonperson/loan-basics.html",
          domain: "rbi.org.in",
          claim_supported: `${genericLoanEvidence} ${row.topic} is easy.`,
        }],
      }, focus, {
        sourceEvidence: groundedEvidence([genericLoanEvidence]),
      }),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.research_evidence.missing_claims.length === 0
        && row.missing.every((key) => error.research_evidence.missing_exact_topics.includes(key)),
    );
  }
});

test("SIP pause research requires a concrete method or condition, not availability alone", () => {
  const focus = buildWeeklyCandidateResearchFocus(pauseSipCandidate());
  const generic = "A systematic investment plan uses regular investments. Mutual fund costs may include an expense ratio and an exit load. Mutual funds carry market risk and returns are not guaranteed.";
  const source = {
    title: "Official SIP operations guidance",
    url: "https://www.amfiindia.com/investor/sip-pause",
    domain: "amfiindia.com",
  };
  assert.throws(
    () => validateFocusedResearch({ mode: "openai_web", sources: [source] }, focus, {
      sourceEvidence: groundedEvidence([`${generic} A SIP can be paused.`]),
    }),
    (error) => error.code === "social_research_evidence_insufficient"
      && !error.research_evidence.missing_exact_topics.includes("sip_pause_availability")
      && error.research_evidence.missing_exact_topics.includes("sip_pause_process"),
  );
  assert.throws(
    () => validateFocusedResearch({ mode: "openai_web", sources: [source] }, focus, {
      sourceEvidence: groundedEvidence([`${generic} A SIP can be paused. A SIP pause facility is mentioned in this article.`]),
    }),
    (error) => error.research_evidence.missing_exact_topics.includes("sip_pause_process"),
  );

  const validated = validateFocusedResearch({ mode: "openai_web", sources: [source] }, focus, {
    sourceEvidence: groundedEvidence([
      `${generic} Investors can pause their SIP by submitting a pause request through the AMC portal for a selected number of months.`,
    ]),
  });
  assert.ok(validated.exact_topic_coverage.every((item) => item.covered));
});

test("questions and vague discussion cannot satisfy exact SIP or loan mechanics", () => {
  const sipFocus = buildWeeklyCandidateResearchFocus(loanTopicCandidate("What happens when a SIP payment is missed?"));
  const sipGeneric = "A systematic investment plan uses regular investments. Mutual fund costs may include an expense ratio and an exit load. Mutual funds carry market risk and returns are not guaranteed.";
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{ title: "Discussion", url: "https://www.sebi.gov.in/investor/discussion", domain: "sebi.gov.in" }],
    }, sipFocus, {
      sourceEvidence: groundedEvidence([`${sipGeneric} If a SIP payment is missed, you may call the bank to ask what happens next.`]),
    }),
    (error) => error.research_evidence.missing_exact_topics.includes("sip_missed_instalment"),
  );

  const loanGeneric = "A personal loan may include interest and processing charges. EMI repayment continues through the tenure, while late payment or default may attract a penalty and affect credit history.";
  for (const [topic, sentence, missingKey] of [
    ["Loan prepayment rules", "Borrowers may wonder whether they can pre-pay.", "loan_prepayment_availability"],
    ["Loan prepayment rules", "Borrowers can read about how to pre-pay.", "loan_prepayment_availability"],
    ["Floating interest rates", "Floating interest rates may be confusing.", "loan_floating_rate"],
    ["Floating interest rates", "Floating interest rates may be explained in a later article.", "loan_floating_rate"],
    ["Hidden charges in loans", "Borrowers should ask if loans include hidden charges.", "loan_hidden_charges"],
    ["Hidden charges in loans", "Loans may feature an article about hidden charges.", "loan_hidden_charges"],
    ["Loan processing fees", "Loans may include an article about processing fees.", "loan_processing_fee"],
  ]) {
    const focus = buildWeeklyCandidateResearchFocus(loanTopicCandidate(topic));
    assert.throws(
      () => validateFocusedResearch({
        mode: "openai_web",
        sources: [{ title: "Loan discussion", url: "https://www.rbi.org.in/commonperson/loan-discussion", domain: "rbi.org.in" }],
      }, focus, { sourceEvidence: groundedEvidence([`${loanGeneric} ${sentence}`]) }),
      (error) => error.research_evidence.missing_exact_topics.includes(missingKey),
    );
  }
});

test("mixed finance and unenumerated high-stakes topics fail closed before copy generation", () => {
  const mixed = buildWeeklyCandidateResearchFocus(loanTopicCandidate("Should you pause your SIP to make a loan prepayment?"));
  assert.equal(mixed.topic_family, "MIXED_FINANCE");
  assert.throws(
    () => validateFocusedResearch({ mode: "openai_web", sources: [] }, mixed),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.research_evidence.missing_exact_topics.includes("mixed_finance_topic_unsupported"),
  );

  const taxation = buildWeeklyCandidateResearchFocus(loanTopicCandidate("Taxation of SIP redemptions"));
  assert.equal(taxation.topic_family, "SIP");
  assert.deepEqual(
    taxation.exact_topic_requirements.map((item) => item.key),
    ["unsupported_topic_specific_claim"],
  );
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{ title: "Generic SIP page", url: "https://www.sebi.gov.in/investor/sip", domain: "sebi.gov.in" }],
    }, taxation, {
      sourceEvidence: groundedEvidence([
        "A systematic investment plan uses regular investments. Mutual fund costs may include an expense ratio and an exit load. Mutual funds carry market risk and returns are not guaranteed. Taxation. Redemptions.",
      ]),
    }),
    (error) => error.research_evidence.missing_exact_topics.includes("unsupported_topic_specific_claim"),
  );
});

test("EPF, NPS, tax, insurance, and other regulated finance topics require exact authoritative grounding", () => {
  const cases = [
    {
      topic: "How EPF withdrawals are taxed",
      url: "https://www.incometax.gov.in/iec/foportal/help/epf-withdrawal-tax",
      domain: "incometax.gov.in",
      evidence: "TDS may be deducted from an EPF withdrawal when the member has less than five years of continuous service, while specified exemption conditions may apply.",
      expectedKey: "epf_withdrawal_tax_conditions",
    },
    {
      topic: "NPS exit and withdrawal rules",
      url: "https://www.pfrda.org.in/nps-exit-withdrawal",
      domain: "pfrda.org.in",
      evidence: "On normal NPS exit, a subscriber must use the required percentage of the corpus to purchase an annuity and may withdraw the permitted balance as a lump sum.",
      expectedKey: "nps_exit_withdrawal_conditions",
    },
    {
      topic: "Insurance policy exclusions and claim settlement",
      url: "https://www.irdai.gov.in/policyholder/claim-settlement",
      domain: "irdai.gov.in",
      evidence: "An insurance policy exclusion identifies a circumstance that is not covered, and the insurer assesses the claim against those policy terms before deciding settlement.",
      expectedKey: "insurance_exclusion_claim_effect",
    },
  ];

  for (const row of cases) {
    const focus = buildWeeklyCandidateResearchFocus(regulatedFinanceCandidate(row.topic));
    assert.equal(focus.topic_family, "REGULATED_FINANCE");
    assert.equal(focus.requires_authoritative_primary, true);
    assert.equal(focus.exact_topic_requirements[0].key, row.expectedKey);
    assert.throws(
      () => validateFocusedResearch({ mode: "openai_web", sources: [] }, focus),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.research_evidence.missing_exact_topics.includes(row.expectedKey),
    );

    const validated = validateFocusedResearch({
      mode: "openai_web",
      sources: [{ title: row.topic, url: row.url, domain: row.domain }],
    }, focus, { sourceEvidence: groundedEvidence([row.evidence]) });
    assert.equal(validated.sources.length, 1);
    assert.equal(validated.sources[0].authoritative_primary, true);
    assert.equal(validated.exact_topic_coverage[0].covered, true);
  }
});

test("a regulated-finance keyword list or non-authoritative article cannot unlock copy generation", () => {
  const focus = buildWeeklyCandidateResearchFocus(
    regulatedFinanceCandidate("Insurance policy exclusions and claim settlement"),
  );
  const keywordList = "Insurance. Policy. Exclusions. Claim. Settlement.";
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{
        title: "Insurance glossary",
        url: "https://www.irdai.gov.in/policyholder/glossary",
        domain: "irdai.gov.in",
      }],
    }, focus, { sourceEvidence: groundedEvidence([keywordList]) }),
    (error) => error.research_evidence.missing_exact_topics.includes("insurance_exclusion_claim_effect"),
  );
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{
        title: "Unverified insurance article",
        url: "https://example.com/insurance-claims",
        domain: "example.com",
      }],
    }, focus, {
      sourceEvidence: groundedEvidence([
        "An insurance policy exclusion identifies a circumstance that is not covered, and the insurer assesses the claim against those policy terms before deciding settlement.",
      ]),
    }),
    (error) => error.research_evidence.authoritative_source_found === false,
  );
});

test("vague regulated-finance relations cannot satisfy claim-level evidence contracts", () => {
  for (const [topic, domain, url, evidence, expectedKey] of [
    ["How EPF withdrawals are taxed", "incometax.gov.in", "https://www.incometax.gov.in/epf", "EPF withdrawal tax applies after years.", "epf_withdrawal_tax_conditions"],
    ["NPS exit and withdrawal rules", "pfrda.org.in", "https://www.pfrda.org.in/nps", "NPS exit is allowed at age.", "nps_exit_withdrawal_conditions"],
    ["Insurance policy exclusions and claim settlement", "irdai.gov.in", "https://www.irdai.gov.in/claims", "Insurance policy exclusions mean claim settlement terms and conditions.", "insurance_exclusion_claim_effect"],
  ]) {
    const focus = buildWeeklyCandidateResearchFocus(regulatedFinanceCandidate(topic));
    assert.throws(
      () => validateFocusedResearch({ mode: "openai_web", sources: [{ title: topic, domain, url }] }, focus, {
        sourceEvidence: groundedEvidence([evidence]),
      }),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.research_evidence.missing_exact_topics.includes(expectedKey),
    );
  }
});

test("regulated-finance topics without an approved semantic contract fail closed", () => {
  const focus = buildWeeklyCandidateResearchFocus(regulatedFinanceCandidate("PPF maturity extension rules"));
  assert.equal(focus.exact_topic_requirements[0].key, "unsupported_regulated_finance_topic");
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [{ title: "PPF rules", domain: "incometax.gov.in", url: "https://www.incometax.gov.in/ppf" }],
    }, focus, { sourceEvidence: groundedEvidence(["PPF maturity extension rules apply to account holders."]) }),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.research_evidence.missing_exact_topics.includes("unsupported_regulated_finance_topic"),
  );
});

test("common regulated banking and investment topics cannot bypass claim-level contracts", () => {
  for (const topic of [
    "Recurring deposit premature withdrawal penalty",
    "Savings account interest and minimum balance",
    "KYC for a bank account",
    "NEFT transfer limits",
    "ETF expense ratios and tracking error",
  ]) {
    const focus = buildWeeklyCandidateResearchFocus(regulatedFinanceCandidate(topic));
    assert.equal(focus.topic_family, "REGULATED_FINANCE");
    assert.equal(focus.exact_topic_requirements[0].key, "unsupported_regulated_finance_topic");
  }
});

test("glossary, newsletter, and noun-fragment finance text cannot satisfy claim contracts", () => {
  const sipFocus = buildWeeklyCandidateResearchFocus(sipCandidate());
  assert.throws(
    () => validateFocusedResearch({ mode: "openai_web", sources: [{ title: "SIP", domain: "amfiindia.com", url: "https://www.amfiindia.com/sip" }] }, sipFocus, {
      sourceEvidence: groundedEvidence(["The SIP glossary uses regular investment as a keyword. Mutual fund costs may include an expense ratio and exit load. Mutual fund returns are not guaranteed."]),
    }),
    (error) => error.research_evidence.missing_claims.includes("mechanics"),
  );
  const loanFocus = buildWeeklyCandidateResearchFocus(loanTopicCandidate("Loan basics"));
  assert.throws(
    () => validateFocusedResearch({ mode: "openai_web", sources: [{ title: "Loan", domain: "rbi.org.in", url: "https://www.rbi.org.in/loan" }] }, loanFocus, {
      sourceEvidence: groundedEvidence(["Loan costs may include processing fees. Loan repayments are discussed in a monthly newsletter. Late payments may affect your credit score. Loan repayment schedule."]),
    }),
    (error) => error.research_evidence.missing_claims.includes("repayment_obligations"),
  );
});

test("availability-only statements cannot satisfy finance topics that ask how a change works", () => {
  const sipGeneric = "A systematic investment plan uses regular investments. Mutual fund costs may include an expense ratio and an exit load. Mutual funds carry market risk and returns are not guaranteed.";
  for (const [topic, sentence, key] of [
    ["How to stop a SIP", "Investors may stop their SIP.", "sip_stop_or_cancel"],
    ["How to resume a SIP", "Investors may resume their SIP.", "sip_resume_or_restart"],
    ["How to change a SIP amount", "Investors may change their SIP amount.", "sip_change_amount"],
  ]) {
    const focus = buildWeeklyCandidateResearchFocus({ ...sipCandidate(), topic, title: topic });
    assert.throws(
      () => validateFocusedResearch({
        mode: "openai_web",
        sources: [{ title: "SIP guide", url: "https://www.amfiindia.com/investor/sip-guide", domain: "amfiindia.com" }],
      }, focus, { sourceEvidence: groundedEvidence([`${sipGeneric} ${sentence}`]) }),
      (error) => error.research_evidence.missing_exact_topics.includes(key),
    );
  }

  const loanGeneric = "A personal loan may include interest and processing charges. EMI repayment continues through the tenure, while late payment or default may attract a penalty and affect credit history.";
  for (const [topic, sentence, key] of [
    ["How loan foreclosure works", "Borrowers may foreclose a loan.", "loan_foreclosure"],
    ["How loan processing fees work", "Processing fees may apply.", "loan_processing_fee"],
  ]) {
    const focus = buildWeeklyCandidateResearchFocus(loanTopicCandidate(topic));
    assert.throws(
      () => validateFocusedResearch({
        mode: "openai_web",
        sources: [{ title: "Loan guide", url: "https://www.rbi.org.in/commonperson/loan-guide", domain: "rbi.org.in" }],
      }, focus, { sourceEvidence: groundedEvidence([`${loanGeneric} ${sentence}`]) }),
      (error) => error.research_evidence.missing_exact_topics.includes(key),
    );
  }
});

test("direct authoritative-page verification blocks unsafe redirects and oversized bodies", async () => {
  const startUrl = "https://www.sebi.gov.in/investor/source.html";
  let redirectFetches = 0;
  await assert.rejects(
    () => researchPrivate.fetchGroundedSourceEvidence(startUrl, {
      dependencies: {
        researchPageLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        researchPageFetchImpl: async () => {
          redirectFetches += 1;
          return {
            ok: false,
            status: 302,
            headers: {
              get: (name) => name.toLowerCase() === "location" ? "https://127.0.0.1/private" : null,
            },
          };
        },
      },
      timeoutMs: 1000,
      maximumBytes: 1024,
    }),
    /private hostname|not allowlisted/i,
  );
  assert.equal(redirectFetches, 1);

  let bodyReads = 0;
  await assert.rejects(
    () => researchPrivate.fetchGroundedSourceEvidence(startUrl, {
      dependencies: {
        researchPageLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        researchPageFetchImpl: async (url) => ({
          ok: true,
          status: 200,
          url,
          headers: {
            get: (name) => {
              if (name.toLowerCase() === "content-type") return "text/html";
              if (name.toLowerCase() === "content-length") return "2049";
              return null;
            },
          },
          text: async () => {
            bodyReads += 1;
            return "x".repeat(2049);
          },
        }),
      },
      timeoutMs: 1000,
      maximumBytes: 1024,
    }),
    /research_source_too_large/,
  );
  assert.equal(bodyReads, 0);
});

test("redirected research uses only the canonical final page and never the original citation snippet", async () => {
  const originalUrl = "https://www.sebi.gov.in/investor/fabricated.html";
  const finalUrl = "https://www.amfiindia.com/";
  const focus = buildWeeklyCandidateResearchFocus(sipCandidate());
  const verified = await researchPrivate.verifyFocusedResearchEvidence({
    mode: "openai_web",
    sources: [{
      title: "Fabricated SIP proof",
      url: originalUrl,
      domain: "sebi.gov.in",
      publisher: "Definitely Fake Publisher",
      published_at: "2099-12-31T00:00:00.000Z",
      freshness_hours: 0,
      confidence: 1,
    }],
    signals: [{ source_index: 0, headline: "Fabricated SIP proof" }],
  }, focus, {
    providerSources: [{
      url: originalUrl,
      title: "Fabricated SIP proof",
      evidence_text: "A systematic investment plan uses regular investments. Mutual fund costs may include an expense ratio. Returns are not guaranteed.",
    }],
    dependencies: {
      researchPageLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      researchPageFetchImpl: async (url) => {
        if (url === originalUrl) {
          return {
            ok: false,
            status: 302,
            headers: { get: (name) => name.toLowerCase() === "location" ? finalUrl : null },
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html" : null },
          text: async () => "<title>AMFI home</title><main>Welcome to the official home page.</main>",
        };
      },
    },
  });

  assert.equal(verified.research.sources[0].url, finalUrl);
  assert.equal(verified.research.sources[0].redirected_from_url, originalUrl);
  assert.equal(verified.research.sources[0].publisher, "amfiindia.com");
  assert.equal(verified.research.sources[0].published_at, null);
  assert.equal(verified.research.sources[0].freshness_hours, null);
  assert.equal(verified.research.sources[0].confidence, null);
  assert.equal(verified.research.sources[0].content_verification.method, "direct_fetch");
  assert.throws(
    () => validateFocusedResearch(verified.research, focus, {
      sourceEvidence: verified.sourceEvidence,
    }),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.research_evidence.missing_claims.length === 3,
  );
});

test("each required finance claim must be supported by an authoritative source, not adjacent authority plus non-authoritative copy", () => {
  const focus = buildWeeklyCandidateResearchFocus(sipCandidate());
  assert.throws(
    () => validateFocusedResearch({
      mode: "openai_web",
      sources: [
        {
          title: "Official SIP participation update",
          url: "https://www.amfiindia.com/research/participation",
          domain: "amfiindia.com",
          claim_supported: "The number of SIP accounts increased during the month.",
        },
        {
          title: "Unofficial complete explainer",
          url: "https://finance-blog.example/sip",
          domain: "finance-blog.example",
          claim_supported: "A systematic investment plan uses regular investments; an expense ratio and exit load may apply; mutual funds carry market risk and returns are not guaranteed.",
        },
      ],
    }, focus, {
      sourceEvidence: groundedEvidence([
        "The number of SIP accounts increased during the month.",
        "A systematic investment plan uses regular investments; an expense ratio and exit load may apply; mutual funds carry market risk and returns are not guaranteed.",
      ]),
    }),
    (error) => error.code === "social_research_evidence_insufficient"
      && error.research_evidence.authoritative_source_found === true
      && error.research_evidence.missing_claims.length === 3,
  );
});

test("external research sends the approved weekly focus to web research and returns coverage metadata", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  let suppliedContext = null;
  try {
    const signals = [
      researchSignal(),
      researchSignal({
        headline: "Official mutual-fund cost explanation",
        summary: "An official industry source explains common scheme costs.",
        claimSupported: "Mutual fund costs may include an expense ratio and an exit load where applicable.",
        sourceUrl: "https://www.amfiindia.com/investor/expenses",
        sourceTitle: "Understanding mutual-fund expenses",
        publisher: "Association of Mutual Funds in India",
        sourceType: "INDUSTRY",
      }),
      researchSignal({
        headline: "Unsupported model-authored SIP claim",
        summary: "This summary was returned by the model but its cited page cannot be independently verified.",
        claimSupported: "The model claims a special guaranteed SIP return, but the source page is unavailable.",
        sourceUrl: "https://www.sebi.gov.in/investor/unverified-sip-claim.html",
        sourceTitle: "Unavailable SIP claim page",
      }),
    ];
    const result = await collectExternalResearch({
      now: new Date("2026-09-01T06:00:00.000Z"),
      internalSignals: { summary: {}, priorities: [] },
      settings: {
        research_provider: "openai_web",
        research_domains: ["sebi.gov.in", "amfiindia.com"],
      },
      generationRequest: { weekly_candidate: sipCandidate() },
      dependencies: {
        ...mockResearchPages(standardSipPages()),
        openAiResearch: async ({ context }) => {
          suppliedContext = context;
          return openAiResearchResult(signals);
        },
        collectRssResearch: async () => ({ signals: [], sources: [] }),
      },
    });

    assert.equal(suppliedContext.approved_weekly_candidate.candidate_id, "candidate_sip_basics");
    assert.ok(result.claim_coverage.every((item) => item.covered));
    assert.equal(result.research_focus.topic_family, "SIP");
    assert.equal(result.sources.length, 2);
    assert.ok(result.sources.every((source) => source.validation_status === "verified_grounded_authoritative_source"));
    assert.ok(result.sources.every((source) => source.publisher === source.domain));
    assert.ok(result.sources.every((source) => source.published_at === null));
    assert.ok(result.sources.every((source) => source.freshness_hours === null));
    assert.ok(result.sources.every((source) => source.confidence === null));
    assert.ok(result.signals.every((signal) => !/guaranteed SIP return/i.test(signal.claim_supported)));
    assert.ok(result.rejected.some((row) => row.flags.includes("source_not_grounded_for_approved_topic")));
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_STORE_RAW_PAGE_MARKER/);
    assert.doesNotMatch(JSON.stringify(result.sources), /Unavailable SIP claim page|special guaranteed/i);
    assert.doesNotMatch(result.sources[0].claim_supported, /Model-authored|DO_NOT_STORE_RAW_PAGE_MARKER/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("provider-grounded citation snippets can validate a source when the bounded direct fetch is unavailable", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const signals = [
      researchSignal({ claimSupported: "Fabricated model claim that must be replaced." }),
      researchSignal({
        headline: "Official mutual-fund cost explanation",
        summary: "Model-authored cost summary.",
        claimSupported: "Another model claim that must be replaced.",
        sourceUrl: "https://www.amfiindia.com/investor/expenses",
        sourceTitle: "Understanding mutual-fund expenses",
        publisher: "Association of Mutual Funds in India",
        sourceType: "INDUSTRY",
      }),
    ];
    const providerResult = openAiResearchResult(signals);
    providerResult.web_sources[0].evidence_text = "A systematic investment plan uses regular investments. Mutual funds carry market risk and returns are not guaranteed.";
    providerResult.web_sources[1].evidence_text = "Mutual fund costs may include an expense ratio and an exit load where applicable.";
    const result = await collectExternalResearch({
      settings: {
        research_provider: "openai_web",
        research_domains: ["sebi.gov.in", "amfiindia.com"],
      },
      generationRequest: { weekly_candidate: sipCandidate() },
      dependencies: {
        researchPageLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        researchPageFetchImpl: async () => { throw new Error("Direct page fetch unavailable"); },
        openAiResearch: async () => providerResult,
        collectRssResearch: async () => ({ signals: [], sources: [] }),
      },
    });

    assert.ok(result.claim_coverage.every((item) => item.covered));
    assert.equal(result.sources[0].content_verification.method, "provider_citation");
    assert.doesNotMatch(JSON.stringify(result), /Fabricated model claim|Another model claim/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("focused finance research uses topic-specific web research even when broad discovery normally prefers RSS", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  let openAiCalls = 0;
  let rssCalls = 0;
  try {
    const signals = [
      researchSignal(),
      researchSignal({
        headline: "Official mutual-fund cost explanation",
        summary: "An official industry source explains common scheme costs.",
        claimSupported: "Mutual fund costs may include an expense ratio and an exit load where applicable.",
        sourceUrl: "https://www.amfiindia.com/investor/expenses",
        sourceTitle: "Understanding mutual-fund expenses",
        publisher: "Association of Mutual Funds in India",
        sourceType: "INDUSTRY",
      }),
    ];
    const result = await collectExternalResearch({
      settings: { research_provider: "trusted_rss" },
      generationRequest: { weekly_candidate: sipCandidate() },
      dependencies: {
        ...mockResearchPages(standardSipPages()),
        openAiResearch: async () => {
          openAiCalls += 1;
          return openAiResearchResult(signals);
        },
        collectRssResearch: async () => {
          rssCalls += 1;
          return { signals: [], sources: [] };
        },
      },
    });
    assert.equal(openAiCalls, 1);
    assert.equal(rssCalls, 0);
    assert.equal(result.research_focus.topic_family, "SIP");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("a paid focused research response with no usable signals still preserves call evidence on the evidence-gap error", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    await assert.rejects(
      () => collectExternalResearch({
        settings: { research_provider: "openai_web" },
        generationRequest: { weekly_candidate: sipCandidate() },
        dependencies: {
          openAiResearch: async () => openAiResearchResult([]),
          collectRssResearch: async () => ({ signals: [], sources: [] }),
        },
      }),
      (error) => error.code === "social_research_evidence_insufficient"
        && error.social_stage === "research"
        && error.response_id === "research-response-1"
        && error.attempts.length === 1
        && error.usage.total_tokens === 50
        && error.input_fingerprint === "a".repeat(64)
        && error.output_fingerprint === "b".repeat(64),
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("post-response evidence rejection retains paid research provenance and fails before decision generation", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  let decisionCalls = 0;
  try {
    const incompleteSignals = [researchSignal({
      headline: "Official SIP participation update",
      summary: "An official monthly participation statistic.",
      claimSupported: "The number of SIP accounts increased during the month.",
      sourceUrl: "https://www.amfiindia.com/research/participation",
      sourceTitle: "Monthly SIP participation",
      publisher: "Association of Mutual Funds in India",
      sourceType: "INDUSTRY",
    })];
    await assert.rejects(
      async () => {
        await collectExternalResearch({
          now: new Date("2026-09-01T06:00:00.000Z"),
          internalSignals: { summary: {}, priorities: [] },
          settings: {
            research_provider: "openai_web",
            research_domains: ["amfiindia.com"],
          },
          generationRequest: { weekly_candidate: sipCandidate() },
          dependencies: {
            ...mockResearchPages({
              "https://www.amfiindia.com/research/participation": "<main><p>The number of SIP accounts increased during the month.</p></main>",
            }),
            openAiResearch: async () => openAiResearchResult(incompleteSignals),
            collectRssResearch: async () => ({ signals: [], sources: [] }),
          },
        });
        decisionCalls += 1;
      },
      (error) => error.code === "social_research_evidence_insufficient"
        && error.social_stage === "research"
        && error.provider === "openai"
        && error.model === "test-research-model"
        && error.prompt_version === "social-research-v3"
        && error.response_id === "research-response-1"
        && error.attempts.length === 1
        && error.usage.total_tokens === 50
        && error.input_fingerprint === "a".repeat(64)
        && error.output_fingerprint === "b".repeat(64),
    );
    assert.equal(decisionCalls, 0);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("generation runner focuses an approved weekly SIP candidate and stops before decision generation when evidence is insufficient", async () => {
  const evidenceError = new Error("Approved SIP evidence did not cover costs and risks");
  evidenceError.code = "social_research_evidence_insufficient";
  evidenceError.status = 422;
  evidenceError.statusCode = 422;
  evidenceError.transient = false;
  let receivedFocus = null;
  let decisionCalls = 0;
  const run = {
    _id: "weekly-sip-focused-research-run",
    generation_date: "2026-09-01",
    generation_request: {
      requested_format: "SINGLE_IMAGE",
      visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      weekly_candidate: sipCandidate(),
    },
    weekly_plan_id: "weekly-plan-1",
    weekly_candidate_id: "candidate_sip_basics",
    status: "RUNNING",
    current_stage: "QUEUED",
    attempt_count: 1,
    retry_count: 0,
    max_attempts: 1,
    initiated_by_admin_id: "admin-1",
    stage_executions: [],
    save: async function save() { return this; },
  };
  const audits = [];

  await assert.rejects(
    () => executeGenerationRun(run, {
      dependencies: {
        getSocialManagerSettings: async () => ({
          feature_enabled: true,
          cost_controls: { daily_image_generation_limit: 10 },
          notifications: { notify_on_draft: false, reviewer_emails: [] },
        }),
        enforceMonthlyBudget: async () => undefined,
        buildSocialManagerRuntimeSettings: (settings) => settings,
        collectInternalSignals: async () => ({ summary: {}, recent_history: [], products: [], static_resources: [] }),
        collectExternalResearch: async ({ focus, generationRequest }) => {
          receivedFocus = focus;
          assert.equal(generationRequest.weekly_candidate.candidateId, "candidate_sip_basics");
          throw evidenceError;
        },
        generateDailyDecision: async () => {
          decisionCalls += 1;
          throw new Error("decision generation must not run after focused research failure");
        },
        SocialWeeklyPlan: { updateOne: async () => ({ acknowledged: true }) },
        SocialAuditLog: {
          create: async (value) => {
            audits.push(value);
            return value;
          },
        },
      },
    }),
    (error) => error === evidenceError,
  );

  assert.equal(receivedFocus.topic_family, "SIP");
  assert.equal(receivedFocus.topic, sipCandidate().topic);
  assert.equal(decisionCalls, 0);
  assert.equal(run.last_error.stage, "RESEARCHING");
  assert.equal(run.last_error.code, "social_research_evidence_insufficient");
  assert.equal(audits.length, 1);
});

test("terminal structured research output errors are not replaced by a generic evidence gap", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  const providerError = new Error("Research JSON failed its strict schema");
  providerError.code = "structured_output_invalid";
  providerError.social_stage = "research";
  providerError.prompt_version = "social-research-v3";
  providerError.response_id = "research-invalid-response";
  providerError.validation_errors = ["$.signals[0].claimSupported is required"];
  providerError.attempts = [{ attempt: 1, status: "FAILED" }];
  providerError.usage = { input_tokens: 10, output_tokens: 4, total_tokens: 14 };
  providerError.transient = true;
  try {
    await assert.rejects(
      () => collectExternalResearch({
        settings: { research_provider: "openai_web" },
        generationRequest: { weekly_candidate: sipCandidate() },
        dependencies: {
          openAiResearch: async () => { throw providerError; },
          collectRssResearch: async () => ({ signals: [], sources: [] }),
        },
      }),
      (error) => error === providerError
        && error.response_id === "research-invalid-response"
        && error.validation_errors[0] === "$.signals[0].claimSupported is required"
        && error.usage.total_tokens === 14,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("publishable copy integrity accepts Indian-English punctuation, rupees, and emoji but rejects hidden or unexpected scripts", () => {
  const valid = {
    caption: "Set aside ₹500 today — small steps count. 👩🏽‍💻",
    supportingText: "A practical Indian-English reminder: start small, then stay consistent.",
  };
  assert.equal(validatePublishableCopyIntegrity(valid), valid);

  assert.throws(
    () => validatePublishableCopyIntegrity({ caption: "Keep investing Ж" }),
    (error) => error.code === "structured_output_invalid"
      && error.validation_errors.some((message) => /unexpected non-Latin script/.test(message)),
  );
  assert.throws(
    () => validatePublishableCopyIntegrity({ caption: "Keep\u200B investing" }),
    (error) => error.code === "structured_output_invalid"
      && error.validation_errors.some((message) => /default-ignorable Unicode U\+200B/.test(message)),
  );
});

test("publishable copy integrity rejects semantic truncation at a field limit without silently shortening it", () => {
  const incomplete = `${"x".repeat(156)} and`;
  assert.equal(incomplete.length, 160);
  assert.throws(
    () => validatePublishableCopyIntegrity({ supportingText: incomplete }),
    (error) => error.code === "structured_output_invalid"
      && error.validation_errors.some((message) => /semantically incomplete|rewrite it rather than truncating/.test(message)),
  );
});

test("near-limit display headlines and CTAs reject dangling words without requiring sentence punctuation", () => {
  const completeHeadline = `${"Pause and verify ".repeat(6)}`.trim().slice(0, 79);
  assert.doesNotThrow(() => validatePublishableCopyIntegrity({ selectedHeadline: completeHeadline }));

  const danglingHeadline = `${"x".repeat(76)} and`;
  const danglingCta = `${"x".repeat(176)} and`;
  assert.equal(danglingHeadline.length, 80);
  assert.equal(danglingCta.length, 180);
  for (const value of [
    { selectedHeadline: danglingHeadline },
    { cta: danglingCta },
  ]) {
    assert.throws(
      () => validatePublishableCopyIntegrity(value),
      (error) => error.code === "structured_output_invalid"
        && error.validation_errors.some((message) => /dangling final word/.test(message)),
    );
  }
});

test("copy-integrity failures use bounded structured-output retry feedback", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  Math.random = () => 0;
  const requests = [];
  try {
    const result = await callStructuredResponse({
      stage: "format_copy",
      input: { selectedFormat: "SINGLE_IMAGE" },
      schema: SIMPLE_COPY_SCHEMA,
      validateOutput: validatePublishableCopyIntegrity,
      settings: { cost_controls: { retry_limit: 1 } },
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: `response-${requests.length}`,
            status: "completed",
            output_text: JSON.stringify({
              caption: requests.length === 1 ? "Save this\u202E now" : "Save this practical reminder now.",
            }),
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
        };
      },
    });
    assert.equal(requests.length, 2);
    assert.match(requests[1].input[1].content[0].text, /default-ignorable Unicode U\+202E/);
    assert.equal(result.attempt_count, 2);
    assert.equal(result.output.caption, "Save this practical reminder now.");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    Math.random = previousRandom;
  }
});

test("terminal structured-output errors retain their exact social stage, attempts, usage, and validation details", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    await assert.rejects(
      () => callStructuredResponse({
        stage: "format_copy",
        input: {},
        schema: SIMPLE_COPY_SCHEMA,
        validateOutput: validatePublishableCopyIntegrity,
        maxAttempts: 1,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id: "failed-copy-response",
            status: "completed",
            output_text: JSON.stringify({ caption: "Unsafe\u200B copy" }),
            usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
          }),
        }),
      }),
      (error) => error.code === "structured_output_invalid"
        && error.social_stage === "format_copy"
        && error.attempts.length === 1
        && error.usage.total_tokens === 19
        && error.validation_errors.some((message) => /\$\.caption failed local structured-output validation/.test(message))
        && !JSON.stringify(error).includes("U+200B"),
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("structured text responses fail closed when provider completion status is missing", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    await assert.rejects(
      () => callStructuredResponse({
        stage: "format_copy",
        input: {},
        schema: SIMPLE_COPY_SCHEMA,
        maxAttempts: 1,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id: "missing-completion-status",
            output_text: JSON.stringify({ caption: "A complete-looking payload must still fail." }),
            usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
          }),
        }),
      }),
      (error) => error.code === "structured_output_invalid"
        && error.response_id === "missing-completion-status"
        && error.usage.total_tokens === 5
        && error.validation_errors.some((message) => /\$\.response\.status/.test(message)),
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
