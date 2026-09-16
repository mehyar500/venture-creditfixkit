// functions/api/creditfix/_lib/kit.js
// The CreditFix Kit template engine — deterministic, rule-based, verifiable.
// NO AI. Everything here is a fixed template with buyer intake merged in.
//
// Honesty contract (enforced in tests, not just promised):
//  - NEVER claim or imply a guaranteed score increase.
//  - NEVER promise removal of any specific item.
//  - Language like "many negative items contain errors worth disputing"
//    and "results vary" — always.
//  - ASCII-only output (WinAnsi-safe): toAscii() strips smart quotes,
//    em-dashes, bullets, etc. so the hand-rolled PDF writer never emits
//    bytes the built-in fonts cannot render.

"use strict";

const DISCLAIMER =
  "General information only -- not legal or financial advice. " +
  "Consider consulting a licensed attorney or certified financial professional.";

const SITUATIONS = {
  collections: "Collections",
  "late-payments": "Late payments",
  "thin-file": "Thin credit file",
  mixed: "Mixed (collections + late payments)",
};

const GOALS = {
  "buy-home": "buying a home",
  "buy-car": "buying a car",
  "lower-rates": "lowering your interest rates",
  "rebuild-general": "a general credit rebuild",
};

// ── ASCII sanitizer ─────────────────────────────────────────────────────────
const ASCII_MAP = {
  "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
  "\u2013": "-", "\u2014": "--", "\u2026": "...", "\u2022": "-",
  "\u00B7": "-", "\u00A0": " ", "\u200B": "", "\uFEFF": "",
  "\u2192": "->", "\u2713": "[x]", "\u00A7": "Sec. ",
};
function toAscii(s) {
  return String(s == null ? "" : s)
    .split("")
    .map((c) => (ASCII_MAP[c] !== undefined ? ASCII_MAP[c] : c))
    .join("")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

// ── input hygiene ───────────────────────────────────────────────────────────
function cleanText(s, max) {
  return toAscii(String(s == null ? "" : s)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim().slice(0, max);
}
function intake(raw) {
  const sit = String(raw.situation || "").toLowerCase();
  const goal = String(raw.goal || "").toLowerCase();
  const state = cleanText(raw.state, 2).toUpperCase();
  return {
    name: cleanText(raw.name, 120) || "Valued Customer",
    situation: SITUATIONS[sit] ? sit : "mixed",
    state: /^[A-Z]{2}$/.test(state) ? state : "US",
    goal: GOALS[goal] ? goal : "rebuild-general",
    accounts: cleanText(raw.accounts, 600),
  };
}

// Split the free-text accounts field into a tidy numbered list.
function accountList(accounts) {
  const items = String(accounts || "")
    .split(/[\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return items;
}

// ── 1. Score-factor explainer ───────────────────────────────────────────────
const FACTORS = [
  {
    id: "payment-history",
    name: "Payment history",
    weight: "35%",
    what_it_means:
      "Whether you paid your accounts on time. This is the single biggest slice " +
      "of a FICO score. One 30-day late payment can linger for years; a long " +
      "stretch of on-time payments is the strongest positive signal you can send.",
  },
  {
    id: "amounts-owed",
    name: "Amounts owed (utilization)",
    weight: "30%",
    what_it_means:
      "How much of your available credit you are using, especially on revolving " +
      "accounts like credit cards. High balances relative to limits signal risk. " +
      "Keeping reported utilization under about 30% -- and ideally under 10% -- " +
      "is generally associated with stronger scores.",
  },
  {
    id: "length-history",
    name: "Length of credit history",
    weight: "15%",
    what_it_means:
      "The age of your oldest account, the average age of all accounts, and how " +
      "long since accounts were used. Longer, responsibly-managed history reads " +
      "as lower risk. This factor rewards patience: it improves mostly with time.",
  },
  {
    id: "new-credit",
    name: "New credit",
    weight: "10%",
    what_it_means:
      "Recently opened accounts and hard inquiries. A few inquiries are normal " +
      "when shopping for a loan, but many applications in a short window can look " +
      "desperate. Rate-shopping for a mortgage or auto loan within a short period " +
      "is typically treated as a single inquiry.",
  },
  {
    id: "credit-mix",
    name: "Credit mix",
    weight: "10%",
    what_it_means:
      "Having different kinds of credit (revolving cards plus installment loans, " +
      "for example) can help a little. This is the smallest factor -- never open " +
      "an account you do not need just to 'improve your mix'.",
  },
];

const ANGLE_BY_SITUATION = {
  collections: {
    "payment-history":
      "Collections accounts damage this factor first. Your dispute letters " +
      "(Kit Letters 1 and 2) target the items themselves: many collection " +
      "entries contain errors worth disputing, and deleted or corrected items " +
      "stop weighing on this factor. Results vary -- dispute only what is " +
      "inaccurate, incomplete, or unverifiable.",
    "amounts-owed":
      "Pay down revolving balances in parallel with disputes. A collections " +
      "account itself does not factor utilization, but the card balances around " +
      "it do -- getting utilization under 30% is often the fastest honest " +
      "movement available while disputes run their course.",
    "length-history":
      "Do NOT close your oldest accounts in good standing while cleaning up " +
      "collections. Your oldest card is doing quiet work on this factor; keep " +
      "it open with a small recurring charge paid in full.",
    "new-credit":
      "Resist applying for new cards to 'start fresh' while collections are " +
      "unresolved. Each application adds an inquiry and lowers your average " +
      "account age -- the opposite of what you want right now.",
    "credit-mix":
      "Ignore mix until the collections are addressed. It is 10% of the score " +
      "and the smallest lever you have; chasing it now wastes attention.",
  },
  "late-payments": {
    "payment-history":
      "Late payments ARE this factor. Goodwill letters (Kit Letter 3) ask " +
      "creditors to remove accurately-reported lates as a courtesy -- some " +
      "grant them, many do not, and no one can promise it. Meanwhile, every new " +
      "on-time payment dilutes the old lates. Recency matters: a 2-year-old " +
      "late hurts less than a 2-month-old one.",
    "amounts-owed":
      "High utilization plus late payments is a double hit. Paying balances " +
      "down -- especially the account with the lates -- attacks the two biggest " +
      "factors at once. Autopay at least the minimum on everything, today.",
    "length-history":
      "Keep your oldest accounts open. If a late payment sits on your oldest " +
      "card, that card is still helping on this factor -- closing it would " +
      "remove the age benefit and keep the late's history anyway.",
    "new-credit":
      "Pause new applications for 3-6 months while you rebuild a clean payment " +
      "streak. Inquiries fade in impact after about a year, but a thin recent " +
      "record makes each new one look worse.",
    "credit-mix":
      "Not your lever right now. A clean 12-month payment streak (see the " +
      "rebuild plan) moves this factor's big sibling -- payment history -- far " +
      "more than any new account type would.",
  },
  "thin-file": {
    "payment-history":
      "With a thin file, every single payment is magnified -- you have few " +
      "data points, so each on-time payment carries outsized weight. Start the " +
      "streak now: a secured card in Month 1 (see the plan) begins the clock. " +
      "There is nothing to dispute because there is little history at all.",
    "amounts-owed":
      "On a thin file, one maxed-out card can dominate this factor. Keep the " +
      "new card's reported balance under 10% of its limit -- pay it down " +
      "BEFORE the statement closes, then let a small balance report.",
    "length-history":
      "This is your long game and you start it this month. Your file gets " +
      "older every month you keep accounts open -- there is no shortcut, " +
      "which is why starting early beats starting perfectly.",
    "new-credit":
      "Open accounts deliberately and then STOP. One secured card, then a " +
      "credit-builder product a few months later at most. Each new account " +
      "resets part of your average age on a thin file.",
    "credit-mix":
      "Once you have 6+ months of card history, a small credit-builder loan " +
      "adds an installment tradeline. Modest help, real cost -- do it only " +
      "if the fee is small and the goal timeline allows.",
  },
  mixed: {
    "payment-history":
      "You are fighting on two fronts: collections AND lates both attack this " +
      "factor, which is 35% of the score. Sequence matters -- dispute the " +
      "collections (Letters 1-2) while goodwill-writing the lates (Letter 3), " +
      "and meanwhile build an unbroken on-time streak from today. Attack the " +
      "items AND the behavior at the same time.",
    "amounts-owed":
      "With mixed damage, utilization is often the fastest honest lever. " +
      "Pay down revolving balances toward under 30% (under 10% is better) " +
      "while the dispute cycle runs -- the two efforts compound instead of " +
      "waiting on each other.",
    "length-history":
      "Protect your oldest accounts in good standing. Do not close anything " +
      "old while cleaning up -- you need every month of positive age you can " +
      "keep, and closed accounts stop aging.",
    "new-credit":
      "No new applications until the dispute cycle (Months 1-3) completes. " +
      "New inquiries on top of collections and lates signal distress; let the " +
      "cleanup land first, then add credit deliberately.",
    "credit-mix":
      "Park this factor for now. With mixed negatives, 90% of your leverage " +
      "sits in payment history and utilization -- spend your energy there.",
  },
};

function goalNote(goal) {
  return {
    "buy-home":
      "Because your goal is buying a home: mortgage lenders look hardest at " +
      "payment history and at collections (many loan programs require " +
      "collections to be resolved or below a threshold). Start the dispute " +
      "cycle early -- underwriting timelines are unforgiving.",
    "buy-car":
      "Because your goal is buying a car: auto lenders weight recent payment " +
      "history and utilization heavily, and rate-shopping within a short " +
      "window counts as one inquiry. Get the cleanup underway BEFORE you " +
      "start test-driving.",
    "lower-rates":
      "Because your goal is lowering your rates: card issuers and lenders " +
      "re-price risk on recent behavior. A 6-12 month clean streak plus lower " +
      "utilization is the honest path to better offers -- then call and ask " +
      "for a rate reduction with the improved profile in hand.",
    "rebuild-general":
      "Because your goal is a general rebuild: there is no deadline pressure, " +
      "which is an advantage. Follow the 12-month plan in order and let " +
      "compounding do the work -- consistency beats intensity here.",
  }[goal];
}

function getExplainer(situation, goal) {
  const angles = ANGLE_BY_SITUATION[situation] || ANGLE_BY_SITUATION.mixed;
  return {
    intro:
      "Your FICO-style score is built from five factors. The weights below are " +
      "the published FICO breakdown. " +
      "'Your angle' translates each factor into what it means for YOUR " +
      "situation (" + SITUATIONS[situation] + ") -- where to push, what to " +
      "protect, what to ignore for now. No factor can be gamed overnight; " +
      "results vary and nobody honest can promise a specific score change.",
    factors: FACTORS.map((f) => ({
      name: f.name,
      weight: f.weight,
      what_it_means: f.what_it_means,
      your_angle: angles[f.id],
    })),
    goal_note: goalNote(goal),
  };
}

// ── 2. Dispute letter templates ─────────────────────────────────────────────
// Metro-2-style dispute language. Buyer details merged in. Letters are
// templates the buyer customizes and mails -- never legal advice.

function letterBureaus(inp) {
  const items = accountList(inp.accounts);
  const itemLines = items.length
    ? items.map((a, i) => "  " + (i + 1) + ". " + a).join("\n")
    : "  [LIST EACH ACCOUNT: creditor/collector name, account number,\n   balance, date opened -- one per line]";
  return {
    id: "letter-1",
    title: "Letter 1 -- Initial dispute to the credit bureaus (FCRA Sec. 611)",
    blurb:
      "Send to Equifax, Experian, and TransUnion. Asks each bureau to investigate " +
      "the listed items and remove or correct anything it cannot verify.",
    body_text:
`[YOUR FULL NAME]
${inp.name}
[YOUR STREET ADDRESS]
[CITY, ${inp.state} ZIP]

Date: ______________

VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED

[BUREAU NAME -- Equifax / Experian / TransUnion]
[BUREAU DISPUTE ADDRESS]

Re: Formal dispute of inaccurate information -- FCRA Section 611
Name: ${inp.name}
SSN (last 4): XXX-XX-________
Date of birth: ______________

To the Dispute Department:

I am writing to dispute the following information in my file. Under Section 611
of the Fair Credit Reporting Act (15 U.S.C. Sec. 1681i), I am requesting that
you investigate each item below and remove or correct any information that is
inaccurate, incomplete, or cannot be verified.

DISPUTED ITEMS:
${itemLines}

For each item above, I dispute its accuracy as currently reported. Please
verify with the furnisher using the Metro 2 format and provide me the method
of verification, including the name and address of each furnisher contacted,
as required by law.

Under the FCRA you must complete your investigation within 30 days of
receiving this notice (45 days if I submit additional relevant information
during the initial 30 days). Please send the results of your investigation
and a free updated copy of my report to the address above.

Enclosed: copy of government-issued ID and proof of address.

Sincerely,

_________________________
${inp.name}

BEFORE YOU MAIL:
- Send one copy to EACH bureau (Equifax, Experian, TransUnion) -- separate
  certified letters, return receipt requested. Keep the green cards.
- Keep a copy of everything you send and log the mailing date.
- Dispute only items you believe are inaccurate, incomplete, or unverifiable.
  Filing disputes you know to be frivolous can backfire.
- Expect results in 30-45 days. Calendar a follow-up for day 40.`,
  };
}

function letterValidation(inp) {
  return {
    id: "letter-2",
    title: "Letter 2 -- Debt validation request to a collection agency (FDCPA Sec. 809)",
    blurb:
      "Send to any collector reporting on your file. Demands validation of the " +
      "debt before further collection activity -- a collector that cannot " +
      "validate should stop reporting it.",
    body_text:
`[YOUR FULL NAME]
${inp.name}
[YOUR STREET ADDRESS]
[CITY, ${inp.state} ZIP]

Date: ______________

VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED

[COLLECTION AGENCY NAME]
[AGENCY ADDRESS]

Re: Request for validation -- FDCPA Section 809
Account/reference number (as shown on my credit report): ______________

To whom it may concern:

I received information that you are reporting a collection account in my name.
Under Section 809 of the Fair Debt Collection Practices Act
(15 U.S.C. Sec. 1692g), I am requesting validation of this debt.

Please provide:
  1. The name and address of the original creditor;
  2. Verification that the amount claimed is accurate, with an itemized
     accounting of principal, interest, and fees;
  3. A copy of any signed agreement or judgment establishing that I owe
     this debt to your agency specifically;
  4. Proof that you are licensed to collect in my state, if required.

Until you provide this validation, I ask that you cease all collection
activity on this account as the statute requires. This letter is not an
acknowledgment that I owe the debt; it is a request for proof that I do.

Sincerely,

_________________________
${inp.name}

BEFORE YOU MAIL:
- Send within 30 days of the collector's FIRST contact about the debt to get
  the full FDCPA validation protections. After 30 days you can still ask --
  the collector may simply choose not to answer.
- One letter PER collector/account. Certified mail, return receipt.
- Do NOT include payment, partial payment, or promises to pay in this letter --
  in some states, acknowledging or paying an old debt can restart the clock
  on the statute of limitations. When in doubt, talk to a licensed attorney
  in ${inp.state} before paying anything.`,
  };
}

function letterGoodwill(inp) {
  return {
    id: "letter-3",
    title: "Letter 3 -- Goodwill adjustment request for late payments",
    blurb:
      "A polite ask to the original creditor: remove accurately-reported late " +
      "payments as a courtesy. Works sometimes, often does not -- costs a stamp.",
    body_text:
`[YOUR FULL NAME]
${inp.name}
[YOUR STREET ADDRESS]
[CITY, ${inp.state} ZIP]

Date: ______________

[CREDITOR NAME]
[CUSTOMER SERVICE / EXECUTIVE OFFICE ADDRESS]

Re: Goodwill request -- late payment removal
Account number: ______________

Dear Sir or Madam:

I have been a customer since ______________ and I am writing to ask for a
one-time goodwill adjustment. My account shows late payments on
______________ (dates), which I take responsibility for. Since then I have
maintained a perfect payment record for ______________ months.

[1-2 sentences on what happened -- brief, honest, no novel. Example: "I lost
my job in early 2023 and fell behind for two months before catching up."]

I am working to rebuild my credit ${inp.goal === "buy-home" ? "ahead of a home purchase" : inp.goal === "buy-car" ? "ahead of an auto purchase" : "and lower my borrowing costs"}, and these marks are the main obstacle. I am asking
whether you would consider removing the late notations as a courtesy to a
longstanding customer in good standing. I understand you are not obligated
to do so.

Thank you for your time and consideration.

Sincerely,

_________________________
${inp.name}

BEFORE YOU MAIL:
- Send to the ORIGINAL CREDITOR (the bank/card issuer), not the bureaus.
  Goodwill goes to whoever reported the late.
- One account per letter. Address it to an executive/office-of-the-president
  address if you can find one -- front-line reps usually cannot grant this.
- Be unfailingly polite. One ask, no threats, no legal citations -- this is
  a favor, not a dispute.
- Honest expectation: many creditors say no. The stamp is cheap; the ask is
  free. Keep paying on time regardless.`,
  };
}

function lettersFor(inp) {
  const letters = [letterBureaus(inp)];
  const hasCollections = inp.situation === "collections" || inp.situation === "mixed";
  const hasLates = inp.situation === "late-payments" || inp.situation === "mixed";
  const l2 = letterValidation(inp);
  const l3 = letterGoodwill(inp);
  if (inp.situation === "thin-file") {
    l2.keep_on_file =
      "KEEP ON FILE: with a thin file and no negative items, you likely have " +
      "nothing to validate right now. Save this template in case a collection " +
      "ever appears -- the rebuild plan below is your main event.";
    l3.keep_on_file =
      "KEEP ON FILE: no late payments to ask about yet. Save this template; " +
      "if a late ever lands, a prompt goodwill letter is your first move.";
    return [letters[0], l2, l3];
  }
  if (hasCollections && hasLates) return [letters[0], l2, l3];
  if (hasCollections) {
    l3.keep_on_file =
      "KEEP ON FILE: your situation centers on collections rather than late " +
      "payments, so this letter is secondary for you. Save it in case a late " +
      "payment ever needs addressing.";
    return [letters[0], l2, l3];
  }
  l2.keep_on_file =
    "KEEP ON FILE: your situation centers on late payments rather than " +
    "collections. Save this template in case a collection account ever appears.";
  return [letters[0], l2, l3];
}

// ── 3. Twelve-month rebuild plan ────────────────────────────────────────────
function planFor(inp) {
  const s = inp.situation;
  const common = {
    mailing_checklist: [
      "Send every dispute and validation letter by CERTIFIED MAIL, RETURN RECEIPT REQUESTED.",
      "Keep a photocopy (or phone photo) of everything you mail, plus the certified receipt.",
      "Log in a notebook or spreadsheet: what you sent, to whom, the date mailed, the green-card return date.",
      "Calendar day 35 after each mailing: if a bureau has not responded, follow up in writing referencing the original certified tracking number.",
      "Never send originals of your ID -- copies only.",
    ],
  };
  const plans = {
    collections: [
      { month: 1, tasks: [
        "Pull your free reports from all three bureaus (AnnualCreditReport.com). Highlight every collection account.",
        "Mail Letter 1 (bureau disputes) to Equifax, Experian, and TransUnion -- certified mail, return receipt. Log the dates.",
        "Mail Letter 2 (validation) to each collection agency -- certified mail, return receipt.",
        "Set every open account to autopay at least the minimum. No new lates from today forward.",
      ]},
      { month: 2, tasks: [
        "Wait for green cards; log every return. Do NOT dispute the same items again while an investigation is open.",
        "List debts smallest to largest. Decide your pay strategy for any VALID debts you intend to settle -- but do not pay anything yet.",
        "If a collector cannot validate within the window, note it: an unvalidated debt should not be reported.",
      ]},
      { month: 3, tasks: [
        "Review bureau investigation results as they arrive. For any deleted item: confirm it is gone on the updated report.",
        "For verified-but-still-wrong items: send a follow-up dispute with specifics on WHAT is wrong (wrong balance? wrong dates? not yours?).",
        "For valid debts you choose to resolve: negotiate pay-for-delete IN WRITING before paying a cent. Get the agreement letter first.",
      ]},
      { month: 4, tasks: [
        "Second dispute round for stubborn items -- new, more specific disputes with any new evidence.",
        "Begin paying down revolving balances: target under 30% utilization on each card.",
        "Check your reports again -- confirm deletions stuck and no re-aged dates appeared (re-aging old debt is illegal; document it if you see it).",
      ]},
      { month: 5, tasks: [
        "Continue the paydown. Every card under 30%; aim for under 10% on at least one.",
        "If any collector is reporting a debt they failed to validate, dispute it with the bureaus again citing the failed validation.",
        "Start a small emergency buffer ($500 goal) so a surprise bill never becomes a new collection.",
      ]},
      { month: 6, tasks: [
        "Mid-year report pull. Compare against your Month 1 reports line by line.",
        "Any remaining valid collections: settle or set up payment plans -- get EVERYTHING in writing first.",
        "Keep the on-time streak unbroken: six months clean is a real milestone lenders notice.",
      ]},
      { month: 7, tasks: [
        "If utilization is under control and disputes are resolved, consider ONE secured card if you have no open revolving account.",
        "Use it for one small recurring bill; autopay the full statement balance.",
        "Do not apply for multiple cards -- one inquiry, one account.",
      ]},
      { month: 8, tasks: [
        "Goodwill letters (Letter 3) to original creditors for any remaining accurately-reported lates.",
        "Review all three reports for errors the dispute rounds missed -- wrong addresses, duplicate accounts, unfamiliar inquiries.",
      ]},
      { month: 9, tasks: [
        "Dispute any newly found errors with Letter 1 (second-generation disputes are normal).",
        "Emergency fund target: $1,000. This is credit protection -- cash prevents future negatives.",
        "Nine months of on-time payments: this streak is now your strongest asset.",
      ]},
      { month: 10, tasks: [
        "Pull reports again. Everything disputed should now read correctly or be gone.",
        "If a furnisher keeps verifying wrong data, file a CFPB complaint (consumerfinance.gov) with your paper trail attached.",
        "Begin researching your goal: " + GOALS[inp.goal] + " -- know what profile lenders want to see.",
      ]},
      { month: 11, tasks: [
        "Final cleanup pass: any lingering item gets one last specific dispute.",
        "Keep utilization low through the holidays -- high December balances report in January.",
        "Document your full 11-month streak: payment confirmations, $0-late record.",
      ]},
      { month: 12, tasks: [
        "Final report pull from all three bureaus. Archive the before/after comparison -- it is proof of work.",
        "Shift to maintenance mode: autopay everything, utilization under 10%, check reports twice a year.",
        "If buying a home or car: start lender conversations NOW with 12 months of clean history behind you.",
      ]},
    ],
    "late-payments": [
      { month: 1, tasks: [
        "Autopay the MINIMUM on every account today -- then autopay the full statement on cards you can afford to.",
        "Pull all three bureau reports. List every late: creditor, date, how late (30/60/90).",
        "Mail Letter 3 (goodwill) to the creditor with your oldest or most damaging late.",
      ]},
      { month: 2, tasks: [
        "Mail goodwill letters to the next creditor(s). One account per letter; stagger them weekly.",
        "Pay down the highest-utilization card first -- lates plus high balances compound the damage.",
        "Calendar: no new applications for 90 days while the streak builds.",
      ]},
      { month: 3, tasks: [
        "Three months clean. Log it -- recency is already diluting the old lates.",
        "Follow up on any goodwill letter older than 45 days with a brief polite second ask.",
        "If a late is FACTUALLY wrong (wrong date, wrong account), dispute it with Letter 1 instead of goodwill.",
      ]},
      { month: 4, tasks: [
        "Utilization check: every card under 30%. Pay before the statement closing date to control what reports.",
        "Keep goodwill cadence: one polite follow-up per creditor, max two asks per account, then move on.",
        "Do not close any card with a late on it -- the history stays; only the age benefit leaves.",
      ]},
      { month: 5, tasks: [
        "Five-month streak. If any creditor granted a goodwill deletion, verify it on the updated report.",
        "Emergency buffer: $500 minimum so one surprise never creates a new late.",
        "Review reports for any error you missed in Month 1.",
      ]},
      { month: 6, tasks: [
        "Mid-year pull: compare late notations against Month 1. Note every removal or aging improvement.",
        "Ask current card issuers for a credit-limit increase (no hard inquiry -- ask first). Higher limits lower utilization automatically.",
        "Six months on-time: many lenders' internal models start treating you differently here.",
      ]},
      { month: 7, tasks: [
        "Second goodwill round for creditors who never answered -- new recipient (executive office), same politeness.",
        "Keep balances low; summer spending is a classic streak-killer.",
      ]},
      { month: 8, tasks: [
        "Consider a credit-builder loan ONLY if: 8-month streak intact, fee is small, and your goal timeline allows.",
        "Otherwise keep it simple: cards + on-time + low utilization is the whole game.",
      ]},
      { month: 9, tasks: [
        "Nine months clean. Old lates are now aging into less-damaging territory.",
        "Final goodwill attempts for any remaining lates -- then accept the file as-is and let time work.",
      ]},
      { month: 10, tasks: [
        "Report pull. Confirm every goodwill win actually posted.",
        "If buying soon: get pre-qualified to see where you stand -- " + GOALS[inp.goal] + " timelines start here.",
        "No new credit unless your goal requires it.",
      ]},
      { month: 11, tasks: [
        "Protect the streak through the holidays: set calendar reminders for every due date, not just autopay.",
        "Utilization under 10% heading into year-end.",
      ]},
      { month: 12, tasks: [
        "Full year, zero lates. Pull all three reports and archive the comparison.",
        "Maintenance mode: autopay, low utilization, reports twice a year.",
        "You now have the single most persuasive thing in credit: a 12-month clean record.",
      ]},
    ],
    "thin-file": [
      { month: 1, tasks: [
        "Open ONE secured credit card ($200-$500 deposit you can afford to lock up). Use a major issuer that reports to all three bureaus.",
        "Put ONE small recurring bill on it (a subscription). Set autopay for the full statement balance.",
        "Pull your three reports to establish the baseline -- confirm the new account appears within 60 days.",
      ]},
      { month: 2, tasks: [
        "Pay the card down BEFORE the statement closing date so a tiny balance (under 10% of the limit) reports.",
        "Do not apply for anything else. One account, one inquiry -- patience.",
        "Check that all three bureaus show the account; dispute (Letter 1) if one is missing it after 60 days.",
      ]},
      { month: 3, tasks: [
        "Three months of history. Keep the pattern: small charge, pay in full, tiny reported balance.",
        "Add rent reporting if you rent (a rent-reporting service) -- only if the fee is small and it reports to at least one bureau.",
      ]},
      { month: 4, tasks: [
        "Consider a credit-builder loan or secured installment product -- small, cheap, reports monthly.",
        "Now you have revolving + installment: genuine mix, built honestly.",
        "Still no store cards, no second credit card. Average age of accounts is precious on a thin file.",
      ]},
      { month: 5, tasks: [
        "Five months in: check reports. Two tradelines reporting clean is exactly the trajectory you want.",
        "Keep utilization tiny. On a thin file one maxed card dominates the whole factor.",
      ]},
      { month: 6, tasks: [
        "Six months of history unlocks a FICO score for most people -- check where you stand.",
        "Ask the secured-card issuer about graduation (converting to unsecured and refunding your deposit).",
        "Emergency fund: $500. Thin files break on surprises; cash is your shock absorber.",
      ]},
      { month: 7, tasks: [
        "If the secured card has not graduated, a polite call asking about graduation timelines costs nothing.",
        "Keep both tradelines perfect. Seven months clean on a thin file compounds fast.",
      ]},
      { month: 8, tasks: [
        "Evaluate: is a second card useful yet? Only if your goal (" + GOALS[inp.goal] + ") needs more depth -- otherwise wait.",
        "If yes: one application, one card, then stop for another six months.",
      ]},
      { month: 9, tasks: [
        "Nine months of clean history. Your file is no longer 'thin' -- it is 'young and clean', which lenders like.",
        "Keep the credit-builder loan current; it is doing quiet installment-history work.",
      ]},
      { month: 10, tasks: [
        "Report pull from all three bureaus. Verify every tradeline reports correctly -- dispute errors with Letter 1.",
        "Emergency fund target: $1,000.",
      ]},
      { month: 11, tasks: [
        "If your goal involves a major purchase, start lender conversations now with 11 months of history.",
        "No new accounts in the 6 months before a mortgage application -- let the file stabilize.",
      ]},
      { month: 12, tasks: [
        "One full year of clean history across multiple tradelines. Archive your baseline-to-now comparison.",
        "Maintenance: keep the oldest card open forever, utilization under 10%, autopay everything.",
        "You built a credit file from nothing in 12 months -- that is the whole skill, and it keeps working.",
      ]},
    ],
    mixed: [
      { month: 1, tasks: [
        "Pull all three reports. Separate the damage: collections list vs. late-payment list.",
        "Mail Letter 1 (bureau disputes) for the collections -- certified, return receipt, all three bureaus.",
        "Mail Letter 2 (validation) to each collector -- certified, return receipt.",
        "Autopay minimums on EVERYTHING today. The bleeding stops now.",
      ]},
      { month: 2, tasks: [
        "Mail Letter 3 (goodwill) for your worst late payment while the dispute cycle runs -- two fronts, one month.",
        "Do not dispute and goodwill the SAME item simultaneously; keep each item on one track.",
        "Pay down the highest-utilization card. Under 30% is the first target.",
      ]},
      { month: 3, tasks: [
        "Dispute results arrive. Deleted items: verify on updated reports. Verified-but-wrong items: re-dispute with specifics.",
        "Valid debts you will resolve: negotiate pay-for-delete IN WRITING before paying.",
        "Goodwill follow-ups at day 45 for unanswered letters -- one polite nudge each.",
      ]},
      { month: 4, tasks: [
        "Second dispute round for stubborn collections with new specifics.",
        "Utilization: every card under 30%, pushing toward 10%.",
        "Check for re-aged dates on old collections -- document and dispute if you see it.",
      ]},
      { month: 5, tasks: [
        "Settle or payment-plan remaining valid collections -- written agreements first, always.",
        "Second goodwill round for lates: new recipient, same politeness.",
        "Emergency buffer: $500. Mixed files are fragile; cash prevents relapse.",
      ]},
      { month: 6, tasks: [
        "Mid-year full pull. Line-by-line vs. Month 1.",
        "Six months of on-time payments alongside the cleanup -- this combination is what moves mixed files.",
        "Ask for credit-limit increases (confirm no hard inquiry first).",
      ]},
      { month: 7, tasks: [
        "Any collector that failed validation but still reports: dispute again citing the failed validation.",
        "Goodwill letters for remaining lates -- final polite round per creditor.",
        "No new credit applications until the cleanup is done.",
      ]},
      { month: 8, tasks: [
        "If disputes are largely resolved and utilization is controlled: consider ONE secured card only if you lack open revolving credit.",
        "Otherwise hold: fewer moving parts while the file heals.",
      ]},
      { month: 9, tasks: [
        "Nine-month review. Remaining items should be only valid, accurately-reported ones you are paying or have paid.",
        "CFPB complaint for any furnisher repeatedly verifying wrong data -- attach your paper trail.",
      ]},
      { month: 10, tasks: [
        "Report pull. Confirm all dispute wins and goodwill wins actually posted.",
        "Begin goal research: " + GOALS[inp.goal] + " -- know the target profile.",
      ]},
      { month: 11, tasks: [
        "Final cleanup disputes for anything still wrong -- specific, documented, certified.",
        "Protect the streak: autopay + calendar reminders through year-end.",
      ]},
      { month: 12, tasks: [
        "Final three-bureau pull. Archive before/after -- you earned the comparison.",
        "Maintenance mode: autopay everything, utilization under 10%, reports twice a year.",
        "Twelve months ago this file had two problems. Now it has a system.",
      ]},
    ],
  };
  const months = plans[s] || plans.mixed;
  return { months, mailing_checklist: common.mailing_checklist };
}

// ── kit assembly ────────────────────────────────────────────────────────────
function buildKit(raw) {
  const inp = intake(raw);
  const explainer = getExplainer(inp.situation, inp.goal);
  const letters = lettersFor(inp);
  const plan = planFor(inp);
  const sections = [
    {
      heading: "How your score is built -- and your personal leverage map",
      body: [
        explainer.intro,
        ...explainer.factors.map(
          (f) => f.name + " (" + f.weight + "): " + f.what_it_means + " YOUR ANGLE: " + f.your_angle
        ),
        explainer.goal_note,
      ],
    },
    {
      heading: "Your dispute and goodwill letters",
      body: [
        "Three ready-to-mail templates with your name merged in. Each letter " +
        "includes a 'before you mail' checklist -- read it, it matters as much " +
        "as the letter. Fill in the bracketed fields, print, sign, and send " +
        "certified mail with return receipt.",
        "Letters marked KEEP ON FILE are included for completeness -- save " +
        "them in case your situation changes.",
      ],
    },
    {
      heading: "Your 12-month rebuild plan (" + SITUATIONS[inp.situation] + ")",
      body: [
        "Month-by-month, in order. Do not skip ahead: the sequence is the " +
        "strategy. Each month's tasks assume the previous months are done.",
      ],
    },
    {
      heading: "Mailing checklist -- do this every time",
      body: plan.mailing_checklist,
    },
    {
      heading: "What this kit cannot do (read this)",
      body: [
        "No letter, service, or kit can guarantee a score increase or the " +
        "removal of any specific item. Anyone who promises that is selling " +
        "you something. What these templates do is exercise rights you already " +
        "have: the right to dispute inaccurate information, to demand debt " +
        "validation, and to ask creditors for courtesy adjustments.",
        "Many negative items contain errors worth disputing -- wrong balances, " +
        "wrong dates, accounts that are not yours, debts past the reporting " +
        "limit. Results vary by file, creditor, and bureau.",
        "This kit is general information only -- not legal or financial " +
        "advice. Consider consulting a licensed attorney or certified " +
        "financial professional, especially before paying old debts (in some " +
        "states, paying or acknowledging an old debt can restart the statute " +
        "of limitations clock).",
      ],
    },
  ];
  return {
    title: "CreditFix Kit -- DIY Credit Repair",
    generated_at: new Date().toISOString(),
    buyer: { name: inp.name, state: inp.state },
    situation: inp.situation,
    situation_label: SITUATIONS[inp.situation],
    goal: inp.goal,
    goal_label: GOALS[inp.goal],
    disclaimer: DISCLAIMER,
    sections,
    letters,
    plan: plan.months,
    explainer,
  };
}

// ── teaser shape (free preview on the landing page) ─────────────────────────
function buildTeaser(raw) {
  const inp = intake(raw);
  const explainer = getExplainer(inp.situation, inp.goal);
  return {
    ok: true,
    explainer: {
      intro: explainer.intro,
      factors: explainer.factors.map((f) => ({
        name: f.name,
        weight: f.weight,
        what_it_means: f.what_it_means,
        your_angle: f.your_angle,
      })),
    },
    locked_letters: lettersFor(inp).map((l) => ({
      title: l.title,
      blurb: l.blurb,
      locked: true,
    })),
    cta: "Unlock the full kit for $47: all 3 mail-ready letters with your " +
      "details merged in, plus your personalized 12-month rebuild plan.",
    disclaimer: DISCLAIMER,
  };
}

// Node + Workers compatible export (no import.meta games).
const api = { buildKit, buildTeaser, getExplainer, lettersFor, planFor, intake,
              toAscii, accountList, DISCLAIMER, SITUATIONS, GOALS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
export { buildKit, buildTeaser, getExplainer, lettersFor, planFor, intake,
         toAscii, accountList, DISCLAIMER, SITUATIONS, GOALS };
export default api;
