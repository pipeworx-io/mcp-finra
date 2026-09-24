interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Legal authority typing and the age-labelling contract.
 *
 * Phase 0 of docs/secondary-legal-sources-plan.md (fleet #1970). This is the
 * SHARED shape that 14 federal secondary-legal source packs key on, so it is
 * defined once here rather than retrofitted across 14 packs later.
 *
 * WHAT THIS IS FOR. The product claim is that an agent asking a legal question
 * can rank what it gets back — controlling authority above the issuing agency's
 * own reading of its rule, that above a practitioner manual, that above a law
 * review article, that above a 1910 treatise. No free legal tool does this. The
 * ranking is only possible if every pack labels its documents with the same
 * vocabulary, which is what `AUTHORITY_TYPES` and `BINDING_STATUSES` are.
 *
 * THE TWO AXES ARE NOT THE SAME AXIS, and conflating them is the mistake this
 * file exists to prevent:
 *
 *   authority_type  — what KIND of instrument this is. A property of the
 *                     document. Stable forever. A repealed statute is still a
 *                     statute.
 *   binding_status  — what FORCE it carries. Changes over time (a rule is
 *                     proposed, then binding, then vacated) and is the axis
 *                     `superseded_by` hangs off.
 *
 * A single "authority level" field cannot express "an agency manual that its own
 * staff must follow but which binds no court", and that describes the IRM, the
 * Justice Manual, the MPEP and the TMEP — four of our fourteen sources. Hence
 * two fields.
 *
 * Vocabulary rationale, including everything deliberately EXCLUDED:
 * docs/secondary-legal-authority-vocabulary.md
 */

// ───────────────────────── authority_type ─────────────────────────
//
// Ordered by tier, and the order in this array is not load-bearing — read the
// tier from AUTHORITY_TIER. Each value has to earn its place by changing what a
// caller would DO with the document; a value that only adds a synonym is a value
// that will be filled in inconsistently by 14 packs.

const AUTHORITY_TYPES = [
  // ── Tier 1: controlling. A tribunal in the document's own jurisdiction must
  //    follow it. These are the things an answer should lead with.
  'constitution',        // Constitutional text itself. Separated from `statute`
                         // because nothing supersedes it by ordinary enactment,
                         // so it never carries binding_status 'superseded'.
  'treaty',              // Ratified agreement with domestic force. Not in the
                         // current 14 sources, but included because its absence
                         // would force treaties into `statute`, which is wrong
                         // about how they are amended and displaced.
  'statute',             // Enacted legislation. U.S.C., Public Laws.
  'regulation',          // Legislative rule with the force of law — notice and
                         // comment, codified in the CFR. Distinct from
                         // `agency_guidance` precisely because that one is the
                         // sub-regulatory material that does NOT bind.
  'case',                // Judicial decision. Binding within its own court
                         // hierarchy, persuasive outside it — which is why the
                         // forum-relativity note below matters most here.
  'court_rule',          // FRCP, FRE, local rules. Force of law, but procedural
                         // and promulgated by courts rather than legislatures,
                         // so a caller filtering for "substantive law" needs to
                         // be able to exclude them.

  // ── Tier 2: official interpretation. The issuing body's own reading of an
  //    instrument it administers. Entitled to weight; binds no court.
  'agency_guidance',     // Sub-regulatory: interpretive rules, policy
                         // statements, staff bulletins, no-action letters,
                         // enforcement guidance. EEOC/DOL/NLRB guidance, SEC
                         // staff interpretations, FTC Legal Library.
  'agency_manual',       // The agency's internal operating manual: IRS IRM, DOJ
                         // Justice Manual, USPTO MPEP/TMEP, Copyright Office
                         // Compendium. Split from `agency_guidance` because
                         // these are the documents that carry binding_status
                         // 'binding_on_issuer' — they direct the agency's own
                         // staff while expressly conferring no rights on the
                         // public.
  'legislative_history', // Committee reports, conference reports, floor
                         // statements. Official in origin, interpretive in use.

  // ── Tier 3: practitioner guidance. Authoritative in practice, no legal force.
  'practice_manual',     // Court and tribunal practice manuals: EOIR practice
                         // manuals, FJC benchbooks.
  'jury_instruction',    // Pattern jury instructions. The direct answer to
                         // "what must be proven", which is why they get their
                         // own value rather than sitting inside
                         // `practice_manual` where a caller could not filter
                         // for them.
  'legal_treatise',      // Systematic expert treatment: the GAO Red Book.
                         // Current, maintained, cited by practitioners.
  'legislative_analysis',// CRS reports, GAO reports, Commons Library briefings.
                         // Non-partisan expert analysis prepared for
                         // legislators. NOT tier 2: CRS speaks for nobody and
                         // interprets no rule of its own. NOT tier 4: not
                         // peer-reviewed scholarship either.

  // ── Tier 4: scholarly commentary.
  'scholarly_article',   // Peer-reviewed or law-review published. OpenAlex,
                         // Crossref, DOAJ, Digital Commons.
  'working_paper',       // Preprint or unreviewed. Split from
                         // `scholarly_article` because "has this been through
                         // review" changes how much weight an agent should give
                         // it, and both arrive from the same upstreams.

  // ── Tier 5: historical commentary.
  'historical_treatise', // A treatise whose value is historical rather than
                         // current — the public-domain 1910 titles. Labelled so
                         // an agent never presents one as the current rule.

  // ── Tier 6: reference. Makes no authority claim at all.
  'reference',           // Glossaries, citation guides, dictionaries. Kept
                         // rather than folded into `scholarly_article`, which
                         // would put a definition list in the scholarship tier
                         // and corrupt every ranking that reads it.
] as const;

type AuthorityType = (typeof AUTHORITY_TYPES)[number];

/** The five tiers the product promise names, plus reference for things making no claim. */
const AUTHORITY_TIERS = [
  'controlling',
  'official_interpretation',
  'practitioner_guidance',
  'scholarly_commentary',
  'historical_commentary',
  'reference',
] as const;

type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

const TIER_OF: Record<AuthorityType, AuthorityTier> = {
  constitution: 'controlling',
  treaty: 'controlling',
  statute: 'controlling',
  regulation: 'controlling',
  case: 'controlling',
  court_rule: 'controlling',
  agency_guidance: 'official_interpretation',
  agency_manual: 'official_interpretation',
  legislative_history: 'official_interpretation',
  practice_manual: 'practitioner_guidance',
  jury_instruction: 'practitioner_guidance',
  legal_treatise: 'practitioner_guidance',
  legislative_analysis: 'practitioner_guidance',
  scholarly_article: 'scholarly_commentary',
  working_paper: 'scholarly_commentary',
  historical_treatise: 'historical_commentary',
  reference: 'reference',
};

/** 1 = controlling … 6 = reference. Lower sorts first. */
function authorityTier(t: AuthorityType): AuthorityTier {
  return TIER_OF[t];
}

function authorityTierRank(t: AuthorityType): number {
  return AUTHORITY_TIERS.indexOf(TIER_OF[t]) + 1;
}

/**
 * The one-bit view a lot of callers actually want. Derived rather than stored,
 * so it cannot drift away from authority_type — which is what would happen if
 * `primary`/`secondary` were a column somebody had to remember to set.
 */
function isPrimaryAuthority(t: AuthorityType): boolean {
  return TIER_OF[t] === 'controlling';
}

// ───────────────────────── binding_status ─────────────────────────

const BINDING_STATUSES = [
  'binding',            // A tribunal in this document's own jurisdiction must
                        // follow it. See the forum-relativity note below: this
                        // is the document's claim, not a claim about the
                        // caller's forum.
  'persuasive',         // May be relied on, need not be followed. The default
                        // truthful answer for most secondary material.
  'binding_on_issuer',  // Binds the issuing agency's own staff; creates no
                        // rights in third parties and binds no court. The IRM,
                        // the Justice Manual and the MPEP all say this about
                        // themselves in terms. Collapsing it into 'binding'
                        // would be flatly false; collapsing it into
                        // 'persuasive' loses that an examiner IS required to
                        // follow it, which is the whole reason a patent
                        // practitioner reads the MPEP.
  'proposed',           // Not yet in force: an NPRM's rule text, an introduced
                        // bill, a draft edition. effective_date is in the
                        // future or unknown.
  'superseded',         // Replaced by a later instrument. `superseded_by` names
                        // it. Still served — per Bruce's serve-and-label ruling
                        // we never withhold — but never as current law. The GAO
                        // Red Book third edition against the fourth is exactly
                        // this.
  'repealed',           // Withdrawn with nothing replacing it. Distinct from
                        // 'superseded' because the caller's next action differs:
                        // superseded means go read superseded_by, repealed means
                        // there is nothing to go and read.
  'vacated',            // Struck down by a court. Distinct from 'repealed'
                        // because it was never validly law rather than having
                        // been withdrawn, and because a vacated rule served as
                        // binding is the worst single error this schema can
                        // make.
  'unknown',            // We could not determine it from the source. THE
                        // DEFAULT, deliberately: the alternative to an explicit
                        // 'unknown' is a pack guessing, and a guessed 'binding'
                        // is the most dangerous value in this vocabulary. An
                        // omission has to read as an omission, not as
                        // 'persuasive'.
] as const;

type BindingStatus = (typeof BINDING_STATUSES)[number];

/**
 * BINDING_STATUS IS A CODED VALUE **AND** A PROSE NOTE. Both, not either.
 *
 * Settled here because two shipped tools had already guessed differently. The
 * govinfo GAO tools (#1972) put a whole sentence in `binding_status` — "GAO's own
 * view of federal appropriations law. Persuasive and followed in practice by
 * agency counsel; not binding on courts." That sentence is genuinely more useful
 * to a caller than any enum value, and it is also unrankable, unfilterable and
 * unjoinable. Choosing one loses something real either way:
 *
 *   enum only   — an agent can rank and filter, but "followed in practice by
 *                 agency counsel though not binding on courts" is exactly the
 *                 kind of thing a lawyer needs and `persuasive` does not say.
 *   prose only  — reads well and cannot be computed over. Ranking 14 sources by
 *                 authority is the product promise; it dies here.
 *
 * So `binding_status` is the controlled vocabulary (machine-readable, what
 * authoritySortKey reads) and `binding_note` is the sentence (human-readable,
 * never parsed). A pack SHOULD set both. The enum is what ranks; the note is
 * what explains. Nothing ever infers one from the other — a note is not parsed
 * into a status, because a regex over legal prose producing `binding` is the
 * single worst failure available to this schema.
 */
const BINDING_STATUS_IS_CODED_PLUS_PROSE = true;

/**
 * BINDING IS RELATIVE TO A FORUM AND WE DO NOT KNOW THE CALLER'S FORUM.
 *
 * A Second Circuit opinion is binding in the Second Circuit and persuasive in
 * the Ninth. So `binding_status: 'binding'` means "this instrument carries the
 * force of law within the jurisdiction named in its own `jurisdiction` field",
 * and nothing more. The caller composes (jurisdiction, binding_status) against
 * its own forum. Baking the forum in — a `binding_in_2d_cir` value — would make
 * the field a lie for every other caller, so it is excluded by design.
 */
const BINDING_IS_FORUM_RELATIVE = true;

/**
 * How much a binding_status should discount a document WITHIN its tier. A
 * superseded statute must not outrank a current agency manual when the question
 * is "what is the rule now", and tier alone would rank it above.
 *
 * Multiplied into the sort key rather than bolted on as a special case so the
 * behaviour is one number a reader can check.
 */
const TIER_STEP = 10;

const STATUS_PENALTY: Record<BindingStatus, number> = {
  // In force. No penalty — these three are equally "live", and which of them is
  // the right answer is decided by the TIER, not here.
  binding: 0,
  binding_on_issuer: 0,
  persuasive: 0,
  // Unlabelled costs a little, but we do not bury a document for being honest
  // about what we could not determine. Stays well inside one tier.
  unknown: 2,
  // ── Past TIER_STEP, so these CROSS A TIER BOUNDARY. That is the point and it
  //    is worth being explicit about, because it is the one place where
  //    binding_status outranks authority_type:
  //
  //    superseded statute      = 10 + 12 = 22
  //    current agency manual   = 20 +  0 = 20   ← wins
  //
  //    The default question a caller is asking is "what is the rule NOW", and a
  //    superseded statute is not an answer to it while a current manual is. A
  //    caller asking what the law was in 2019 filters on effective_date and
  //    binding_status explicitly rather than relying on this ordering.
  //
  //    The penalties are sized to cross exactly ONE tier, never two: the largest
  //    is 16, so nothing falls more than one-and-a-bit tiers. A repealed statute
  //    (25) still outranks a practitioner treatise (30), which is deliberate —
  //    the treatise is not law either, and the statute is at least primary text.
  proposed: 11,    // Not yet in force. Lands just below current guidance (20 vs 21).
  superseded: 12,  // A current version exists; prefer it. Read superseded_by.
  repealed: 15,    // Withdrawn, nothing replaces it.
  vacated: 16,     // Struck down. The value most dangerous to serve as current.
};

/**
 * Sort key for "which of these is the better authority". Ascending: lower is
 * stronger. Combines both axes, because either one alone gives a wrong order.
 */
function authoritySortKey(a: Pick<LegalAuthority, 'authority_type' | 'binding_status'>): number {
  return authorityTierRank(a.authority_type) * TIER_STEP + STATUS_PENALTY[a.binding_status ?? 'unknown'];
}

/** Strongest authority first. Stable for equal keys. */
function rankByAuthority<T extends Pick<LegalAuthority, 'authority_type' | 'binding_status'>>(docs: T[]): T[] {
  return docs
    .map((d, i) => ({ d, i, k: authoritySortKey(d) }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map((x) => x.d);
}

function isAuthorityType(v: unknown): v is AuthorityType {
  return typeof v === 'string' && (AUTHORITY_TYPES as readonly string[]).includes(v);
}

function isBindingStatus(v: unknown): v is BindingStatus {
  return typeof v === 'string' && (BINDING_STATUSES as readonly string[]).includes(v);
}

/**
 * A TIER NAME IS NOT AN AUTHORITY TYPE, and something has to say so out loud.
 *
 * The shipped govinfo GAO tools (#1972) emit `authority_type:
 * 'official_interpretation'` — which is a TIER, spanning three types. It is a
 * reasonable-looking mistake and `isAuthorityType` already returns false for it,
 * but a pack that proxies live never touches the CHECK constraint that would
 * reject it, so nothing tells the author. Fourteen packs making this call
 * independently is exactly the "vague enum poisons everything downstream" risk
 * this vocabulary exists to close.
 *
 * Accepting a tier as a type is NOT the fix. `official_interpretation` covers
 * `agency_guidance`, `agency_manual` and `legislative_history`, and collapsing
 * them destroys the only distinction that justifies `binding_on_issuer` — the
 * reason the two-field design exists at all. So the coarse value is refused and
 * the author is told which types to choose between.
 *
 * Returns the valid type, or a diagnosis naming the candidates.
 */
function classifyAuthorityInput(v: unknown):
  | { ok: true; authority_type: AuthorityType }
  | { ok: false; reason: string; candidates: AuthorityType[] } {
  if (isAuthorityType(v)) return { ok: true, authority_type: v };

  if (typeof v === 'string' && (AUTHORITY_TIERS as readonly string[]).includes(v)) {
    const candidates = AUTHORITY_TYPES.filter((t) => TIER_OF[t] === v);
    return {
      ok: false,
      candidates,
      reason: `"${v}" is a TIER, not an authority_type. A tier is derived from the ` +
        `type via authorityTier(); passing it as the type loses the distinction the ` +
        `tier is made of. Pick one of: ${candidates.join(', ')}.`,
    };
  }

  return {
    ok: false,
    candidates: [],
    reason: `"${String(v)}" is not an authority_type. Valid values: ${AUTHORITY_TYPES.join(', ')}.`,
  };
}

// ───────────────────────── licence terms ─────────────────────────
//
// Added for decision #1973 / task #1974: Bruce ruled we WILL mirror CC BY-NC-SA
// material (Cornell LII/Wex, CORE, CALI), served free through the gateway's
// existing `zeroRated` mechanism. That makes the licence side of this shape
// load-bearing in a way a single string cannot carry.
//
// WHY THIS IS PER DOCUMENT AND NOT PER SOURCE. CALI is the proof: most eLangdell
// titles are BY-NC-SA, but *Sources of American Law* is BY-SA with no NC clause.
// A per-pack licence constant mislabels it, and one mis-filed title is the whole
// compliance story. Same shape as the `finra` precedent, where one pack reads two
// distributions under two different sets of terms — which is why `zeroRated`
// accepts a string[] of tool names rather than only `true`.
//
// WHY A US FEDERAL WORK IS NOT "A LICENCE". 17 U.S.C. §105 makes the work
// UNCOPYRIGHTABLE. Nobody granted us anything and there is no licensor, no
// attribution clause and no downstream obligation. Forcing that into a
// CC-shaped field would tell a caller it is bound by terms that do not exist,
// which is its own kind of false statement — so `license_kind` separates the
// two and `obligations` comes back empty rather than defaulting to attribution.

const LICENSE_KINDS = [
  'public_domain_us_gov',   // 17 U.S.C. §105. Uncopyrightable, not licensed.
  'public_domain_expired',  // Copyright lapsed — the Gutenberg treatises.
  'public_domain_dedicated',// CC0 and equivalents: a deliberate dedication.
  'creative_commons',       // A CC grant with clauses that bite. BY/SA/NC/ND.
  'open_government',        // UK OGL, Open Parliament Licence, EU CC BY. Reuse
                            // including commercial reuse is granted, usually
                            // with attribution.
  'permission_none',        // No reuse grant published. Per the standing rule
                            // (`mirror-needs-grant-proxy-does-not`, Bruce
                            // 2026-09-08) we may PROXY this live but must not
                            // mirror it. The corpus table refuses this value —
                            // see the CHECK in migration 196.
  'unknown',                // Not yet checked. Also refused by the corpus table:
                            // "check before you bake, not after".
  'vendor_terms',           // A bespoke API/vendor licence with its own clauses —
                            // the Semantic Scholar API License Agreement, CORE's
                            // Terms & Conditions. Not CC, not open government,
                            // and not "no grant": there IS a grant, it is just
                            // theirs. Proxy-only: such terms forbid passing the
                            // data on as a dataset, so `mayMirror` is false and
                            // the corpus table's CHECK does not admit it. Added
                            // for #1974 so a proxied non-commercial API can carry
                            // real LicenseTerms instead of being mislabelled as
                            // Creative Commons or as unlicensed.
] as const;

type LicenseKind = (typeof LICENSE_KINDS)[number];

/** The clauses that actually constrain a caller. Empty for a public-domain work. */
const LICENSE_OBLIGATIONS = [
  'attribution',    // BY — the credit in `attribution` must be shown.
  'share_alike',    // SA — derivatives must carry the same licence.
  'non_commercial', // NC — the reason #1974 needs zeroRated.
  'no_derivatives', // ND — no modified redistribution.
] as const;

type LicenseObligation = (typeof LICENSE_OBLIGATIONS)[number];

interface LicenseTerms {
  /**
   * SPDX identifier where one exists: 'CC-BY-NC-SA-4.0', 'CC-BY-SA-4.0',
   * 'CC-BY-4.0', 'CC0-1.0', 'OGL-UK-3.0'. US federal works have no SPDX id
   * because they are not licensed at all, so they carry the LicenseRef form
   * 'LicenseRef-US-Gov-Works-17USC105' — distinguishable at a glance from a CC
   * grant, which is the point.
   */
  id: string;
  kind: LicenseKind;
  url: string | null;
  /**
   * The literal attribution string we are required to render, written out. A
   * boolean cannot be shown to a user, and ShareAlike compliance means SHOWING
   * the credit — so this is the text, or null when nothing is required.
   */
  attribution: string | null;
  /** The clauses that bite. Empty array for a public-domain work. */
  obligations: LicenseObligation[];
}

/** 'LicenseRef-' prefix marks an id that is not an SPDX licence — see LicenseTerms.id. */
const US_GOV_LICENSE_ID = 'LicenseRef-US-Gov-Works-17USC105';

/** The terms for a work of the US federal government. No licensor, no clauses. */
function usGovernmentWork(): LicenseTerms {
  return {
    id: US_GOV_LICENSE_ID,
    kind: 'public_domain_us_gov',
    url: 'https://www.law.cornell.edu/uscode/text/17/105',
    attribution: null,
    obligations: [],
  };
}

/**
 * Is the CALLER bound by anything downstream? This is the flag a caller needs in
 * order to comply, and it must be surfaced on the payload: they cannot honour
 * terms we never showed them.
 */
function isEncumbered(l: LicenseTerms): boolean {
  return l.obligations.length > 0;
}

/**
 * Does serving this document have to be free? NC forbids commercial use, and
 * Pipeworx bills per call, so an NC document must route through the gateway's
 * `zeroRated` path. This is the hook #1974 reads; it is derived from the
 * obligations rather than stored, so it cannot drift away from the licence.
 */
function requiresZeroRating(l: LicenseTerms): boolean {
  return l.obligations.includes('non_commercial');
}

/**
 * May we MIRROR this document, as opposed to proxying it live? Bruce's standing
 * rule: `mirror-needs-grant-proxy-does-not` (2026-09-08). Everything in the
 * corpus rail is a mirror by construction, so this has to be true for anything
 * that lands in `secondary_legal_documents` — and migration 196 enforces it in
 * the database rather than trusting 14 loaders to remember.
 */
function mayMirror(l: LicenseTerms): boolean {
  return l.kind !== 'permission_none' && l.kind !== 'unknown' && l.kind !== 'vendor_terms';
}

/** One sentence a caller can render verbatim next to the text. */
function licenseNote(l: LicenseTerms): string {
  if (!isEncumbered(l)) {
    return l.kind === 'public_domain_us_gov'
      ? 'Work of the United States Government — not subject to copyright (17 U.S.C. § 105). No reuse conditions.'
      : `${l.id} — no reuse conditions.`;
  }
  const clauses: string[] = [];
  if (l.obligations.includes('attribution')) {
    clauses.push(`you must credit the source${l.attribution ? ` as: "${l.attribution}"` : ''}`);
  }
  if (l.obligations.includes('share_alike')) clauses.push(`any derivative you publish must carry ${l.id}`);
  if (l.obligations.includes('non_commercial')) clauses.push('you may not use it commercially');
  if (l.obligations.includes('no_derivatives')) clauses.push('you may not publish modified versions');
  return `${l.id} — ${clauses.join('; ')}. These conditions bind you as well as us.`;
}

/**
 * A Creative Commons grant, with the obligations DERIVED from the SPDX id so
 * the two can never disagree: 'CC-BY-NC-SA-2.5' yields attribution +
 * non_commercial + share_alike, and the licence URL is built from the same
 * tokens. `attribution` is the credit line the rightsholder asks for, written
 * out — BY means rendering it, so it travels on the payload verbatim.
 *
 * Added for #1974 (Cornell LII/Wex is BY-NC-SA 2.5 per its own terms page;
 * CALI eLangdell titles are BY-NC-SA 4.0 or BY-SA 4.0 per each book's front
 * matter). A pack that hand-types `obligations` next to an id is one edit
 * away from a BY-SA title labelled non-commercial or the reverse, and one
 * mis-filed title is the whole compliance story.
 */
function creativeCommonsLicense(id: string, attribution: string | null): LicenseTerms {
  const m = /^CC-(0|BY(?:-NC)?(?:-SA|-ND)?)-(\d+\.\d+)$/i.exec(id.trim());
  if (!m) throw new Error(`creativeCommonsLicense: unrecognised id ${JSON.stringify(id)} (expected e.g. CC-BY-NC-SA-4.0 or CC0-1.0-style CC-0-1.0)`);
  const clauses = m[1].toUpperCase();
  const version = m[2];
  if (clauses === '0') {
    return {
      id: `CC0-${version}`,
      kind: 'public_domain_dedicated',
      url: `https://creativecommons.org/publicdomain/zero/${version}/`,
      attribution: null,
      obligations: [],
    };
  }
  const obligations: LicenseObligation[] = ['attribution'];
  if (clauses.includes('-NC')) obligations.push('non_commercial');
  if (clauses.includes('-SA')) obligations.push('share_alike');
  if (clauses.includes('-ND')) obligations.push('no_derivatives');
  return {
    id: `CC-${clauses}-${version}`,
    kind: 'creative_commons',
    url: `https://creativecommons.org/licenses/${clauses.toLowerCase()}/${version}/`,
    attribution,
    obligations,
  };
}

/**
 * Terms that are a vendor's own document rather than a public licence — an API
 * licence agreement we accepted to hold a key. `id` uses the SPDX LicenseRef
 * form so it cannot be mistaken for a CC grant; `url` is the document itself;
 * `obligations` are whichever of the four clauses the document actually
 * imposes, read from it rather than assumed. Always proxy-only (see mayMirror).
 */
function vendorTermsLicense(opts: {
  ref: string;
  url: string;
  attribution: string | null;
  obligations: LicenseObligation[];
}): LicenseTerms {
  const ref = opts.ref.startsWith('LicenseRef-') ? opts.ref : `LicenseRef-${opts.ref}`;
  return { id: ref, kind: 'vendor_terms', url: opts.url, attribution: opts.attribution, obligations: [...opts.obligations] };
}

/**
 * Put the licence ON THE PAYLOAD. Every response of a licensed pack — including
 * soft failures, which are still "derived from" the licensed source — carries
 * `license` (the LicenseTerms: id, kind, url, attribution, obligations),
 * `license_note` (one sentence a caller can render verbatim) and, for BY
 * terms, a top-level `attribution` so the credit is the first thing a
 * synthesising model reads. Leading keys on purpose — mcps/finra established
 * that ordering and the reason (fleet #531): the answer path passes a pack's
 * structuredContent through, so what leads the object leads the answer.
 *
 * This is the coordination point with #1970/#1976: one `license` field, one
 * shape, derived from LicenseTerms — never a second per-pack mechanism.
 */
function attachLicense<T>(result: T, terms: LicenseTerms): Record<string, unknown> {
  const head: Record<string, unknown> = {
    ...(terms.attribution ? { attribution: terms.attribution } : {}),
    license: terms,
    license_note: licenseNote(terms),
  };
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...head, ...(result as Record<string, unknown>) };
  }
  return { ...head, data: result };
}

function isLicenseKind(v: unknown): v is LicenseKind {
  return typeof v === 'string' && (LICENSE_KINDS as readonly string[]).includes(v);
}

function isLicenseObligation(v: unknown): v is LicenseObligation {
  return typeof v === 'string' && (LICENSE_OBLIGATIONS as readonly string[]).includes(v);
}

// ───────────────────────── the envelope ─────────────────────────

/**
 * The authority envelope every secondary-legal pack attaches to a document.
 * Mirrors the columns in supabase/migrations/196_secondary_legal_corpus.sql —
 * keep the two in step.
 */
interface LegalAuthority {
  /** Stable id within the source, e.g. 'R47132' or 'mpep-2106'. */
  doc_id: string;
  /** Pack/source slug this came from, e.g. 'crs-reports'. */
  source: string;
  title: string;

  authority_type: AuthorityType;
  /** Nullable so an honest omission is representable; treated as 'unknown'. */
  binding_status: BindingStatus | null;
  /**
   * The nuance the enum cannot carry, as a sentence a caller can show a human.
   * BOTH fields ship — see BINDING_STATUS_IS_CODED_PLUS_PROSE below.
   *
   * e.g. binding_status: 'persuasive' + binding_note: "GAO's own view of federal
   * appropriations law. Persuasive and followed in practice by agency counsel;
   * not binding on courts."
   */
  binding_note: string | null;

  /**
   * Whose law. Hierarchical so a caller can prefix-match:
   * 'us' · 'us-federal' · 'us-federal-ca9' · 'us-tx' · 'uk' · 'eu'.
   *
   * 'us-federal', NOT 'us-federal': the shipped govinfo GAO tools (#1972) already
   * emit the long form, and matching what is live costs nothing while an
   * abbreviation nobody needs would make two spellings of one jurisdiction.
   */
  jurisdiction: string;
  /** The body that issued it, in its own words: 'Congressional Research Service'. */
  issuer: string;

  /** When the instrument took or takes effect. Null when the source says nothing. */
  effective_date: string | null;
  /** Set when binding_status is superseded/repealed/vacated. A doc_id or citation. */
  superseded_by: string | null;

  /** Citations this document makes, as the source writes them. Never guessed. */
  citations: string[];

  /**
   * The terms WE rely on to serve this document, and the obligations they put on
   * the CALLER. Per document, not per source — see the LicenseTerms doc comment
   * for why that is not a nicety.
   */
  license: LicenseTerms;

  /** When we fetched our copy. Always set by the loader; never by hand. */
  retrieved_at: string;
  /** The source's own last-modified, when it publishes one. */
  source_last_modified: string | null;
}

// ───────────────────────── the age-labelling contract ─────────────────────────
//
// Bruce's ruling, 2026-09-14: SERVE STALE DATA AND LABEL THE AGE. Never refuse.
// So nothing in this section throws, returns null, or withholds a document. The
// only output is a label, and the caller decides.
//
// THE TWO AGES ARE DIFFERENT AND THE FLAG ONLY WATCHES ONE OF THEM.
//
//   age_days        — how old OUR COPY is (now - retrieved_at). This is the one
//                     `stale` keys on, because it is the one that answers "did
//                     our refresh stop running". It is a defect when it grows.
//   source_age_days — how old the DOCUMENT is (now - source_last_modified).
//                     Informational, and NEVER a staleness signal: the
//                     Constitution is 238 years old and perfectly fresh. Wiring
//                     the flag to this instead is the obvious bug here, which is
//                     why they have different names and this paragraph exists.

const DAY_MS = 86_400_000;

/**
 * Per-source tolerance in days: how old our copy may get before we say so.
 * Set from the source's own publication cadence plus one missed cycle, because
 * the failure worth catching is a refresh that STOPPED, not a source that is
 * between releases.
 *
 * A source absent from this map gets DEFAULT_TOLERANCE_DAYS and is reported as
 * using the default, rather than being skipped. An unlisted source that is
 * silently exempt is how a staleness check becomes unable to fail.
 */
const SOURCE_TOLERANCE_DAYS: Record<string, number> = {
  // Continuously revised, so a copy older than ~2 weeks means the cron stopped.
  'crs-reports': 14,
  'doj-justice-manual': 21,
  'irs-irm': 21,
  'govuk-manuals': 14,
  // Weekly to monthly publishers: one cycle plus a missed one.
  'gao-reports': 21,
  'ftc-legal-library': 60,
  'eeoc-dol-nlrb-guidance': 60,
  'sec-staff-interpretations': 60,
  'fjc-publications': 60,
  // Quarterly / edition-driven. Generous on the document, tight enough that a
  // dead refresh still surfaces within a cycle or two.
  'constitution-annotated': 120,
  'eoir-practice-manuals': 120,
  'uspto-mpep': 200,
  'uspto-tmep': 400,
  'copyright-compendium': 400,
  'federal-jury-instructions': 400,
  // Historical corpus: the documents never change, but a re-crawl that stops
  // still means the pipeline is dead, so this is a liveness number not a
  // freshness one.
  'gutenberg-legal': 400,
};

const DEFAULT_TOLERANCE_DAYS = 90;

function sourceToleranceDays(source: string): number {
  return SOURCE_TOLERANCE_DAYS[source] ?? DEFAULT_TOLERANCE_DAYS;
}

interface AgeLabel {
  retrieved_at: string;
  source_last_modified: string | null;
  effective_date: string | null;
  /** Age of OUR COPY in days. What `stale` watches. */
  age_days: number;
  /** Age of the DOCUMENT in days, or null. Informational — never a defect. */
  source_age_days: number | null;
  /**
   * false when the source's own last-modified is known NOT to track content.
   * GAOREPORTS is the case: 16,569 packages, none issued after 2009, every one
   * stamped last_modified 2025-03-07 — a bulk re-stamp. Present, well-formed,
   * recent, and meaningless.
   */
  source_last_modified_trusted: boolean;
  /**
   * The date the CONTENT is actually as-of, when the change signal cannot be
   * believed. Where this is set, source_age_days is measured from it rather than
   * from the re-stamp, because reporting a 2009 report as 191 days old is a
   * confident false statement and "we don't know" would have been better.
   */
  content_as_of: string | null;
  tolerance_days: number;
  /** true when age_days > tolerance_days. Never a reason to withhold. */
  stale: boolean;
  /** Set when tolerance came from DEFAULT_TOLERANCE_DAYS rather than the map. */
  tolerance_is_default: boolean;
  /** One sentence a caller can show a human verbatim. */
  note: string;
}

function ageDays(fromIso: string | null | undefined, nowMs: number): number | null {
  if (!fromIso) return null;
  const ms = Date.parse(fromIso);
  if (Number.isNaN(ms)) return null;
  // Clamp at 0: a retrieved_at a few seconds in the future (clock skew between
  // the loader and the reader) must not read as a negative age.
  return Math.max(0, Math.round(((nowMs - ms) / DAY_MS) * 10) / 10);
}

/**
 * Label a document's age. ALWAYS returns a label — there is no failure mode and
 * no refusal, by ruling.
 *
 * `toleranceOverrideDays` exists so a tool can expose a per-call tolerance and
 * so the contract is testable: lower it and `stale` must flip to true on the
 * same document, which is the red case for this check.
 */
function labelAge(
  doc: Pick<LegalAuthority, 'source' | 'retrieved_at' | 'source_last_modified' | 'effective_date'> & {
    /** Pass false when the source's last_modified is a bulk re-stamp. */
    source_last_modified_trusted?: boolean;
    /** Required when the above is false: what the content is really as-of. */
    content_as_of?: string | null;
  },
  nowMs: number = Date.now(),
  toleranceOverrideDays?: number,
): AgeLabel {
  const mapped = SOURCE_TOLERANCE_DAYS[doc.source];
  const tolerance = toleranceOverrideDays ?? mapped ?? DEFAULT_TOLERANCE_DAYS;
  const toleranceIsDefault = toleranceOverrideDays === undefined && mapped === undefined;

  // A missing or unparseable retrieved_at is not an excuse to skip the check.
  // It reads as infinitely old, which is loud, rather than as fresh, which is
  // the silent failure this whole contract exists to prevent.
  const copyAge = ageDays(doc.retrieved_at, nowMs);
  const age = copyAge ?? Number.POSITIVE_INFINITY;
  // A change signal we cannot believe must not produce a freshness number. Where
  // the source says "trust content_as_of instead", measure the document age from
  // that; where it says neither, report null rather than inventing one.
  const signalTrusted = doc.source_last_modified_trusted !== false;
  const asOf = doc.content_as_of ?? null;
  const srcAge = signalTrusted ? ageDays(doc.source_last_modified, nowMs) : ageDays(asOf, nowMs);
  const stale = age > tolerance;

  // WORDING IS LOAD-BEARING: no possessive. "our copy is 0d old" ships to
  // callers on every response on this rail and tells them we hold a copy, which
  // is against the standing rule to let callers assume pass-through. "retrieved
  // Nd ago" carries the identical meaning — a retrieval time is a fact about
  // the record either way — without making a claim about who stores what.
  // Caught live on crs_recent by Marten (0) before this rail reached its other
  // 13 sources; check:hosting-claims did not catch it because it does not scan
  // shared/ at all.
  const note = copyAge === null
    ? `no usable retrieved_at, so this is treated as stale against the ${tolerance}d tolerance for "${doc.source}"`
    : stale
      ? `retrieved ${age}d ago, past the ${tolerance}d refresh tolerance for "${doc.source}" — served anyway, labelled stale`
      : `retrieved ${age}d ago, within the ${tolerance}d refresh tolerance for "${doc.source}"`;

  return {
    retrieved_at: doc.retrieved_at,
    source_last_modified: doc.source_last_modified ?? null,
    effective_date: doc.effective_date ?? null,
    age_days: age === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : age,
    source_age_days: srcAge,
    source_last_modified_trusted: signalTrusted,
    content_as_of: asOf,
    tolerance_days: tolerance,
    stale,
    tolerance_is_default: toleranceIsDefault,
    note,
  };
}

/**
 * The shape a pack returns for one document: the authority envelope, the age
 * label, and the text. Every secondary-legal tool response carries this so a
 * caller never has to ask a second question to find out how old the answer is.
 */
interface AuthoredDocument extends LegalAuthority {
  tier: AuthorityTier;
  freshness: AgeLabel;
  /**
   * The licence obligations, surfaced ON THE PAYLOAD rather than left in the row.
   * A caller cannot comply with terms we never showed it, so an encumbered
   * document always arrives with the conditions attached and the attribution
   * string spelled out.
   */
  license_terms: {
    encumbered: boolean;
    requires_zero_rating: boolean;
    note: string;
  };
  text?: string;
}

function withAuthorityEnvelope(
  doc: LegalAuthority,
  opts: { text?: string; nowMs?: number; toleranceOverrideDays?: number } = {},
): AuthoredDocument {
  return {
    ...doc,
    tier: authorityTier(doc.authority_type),
    freshness: labelAge(doc, opts.nowMs ?? Date.now(), opts.toleranceOverrideDays),
    license_terms: {
      encumbered: isEncumbered(doc.license),
      requires_zero_rating: requiresZeroRating(doc.license),
      note: licenseNote(doc.license),
    },
    ...(opts.text !== undefined ? { text: opts.text } : {}),
  };
}


/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * FINRA short-sale data — Reg SHO daily short-sale VOLUME plus consolidated
 * bi-monthly SHORT INTEREST.
 *
 * All four tools read the FINRA Query API dataset group `otcMarket` at
 * api.finra.org (keyless, POST + JSON filters). Reg SHO daily volume comes
 * from `regShoDaily`; short interest from `consolidatedShortInterest`.
 *
 * REPORTING FACILITIES. `regShoDaily` returns ONE ROW PER REPORTING FACILITY
 * per symbol per day, and a symbol's real short volume is the SUM of them:
 *
 *   NQTRF  market Q  Nasdaq TRF Carteret  ┐
 *   NYTRF  market N  NYSE TRF             ├─ the consolidated NMS tape (CNMS)
 *   NCTRF  market B  Nasdaq TRF Chicago   ┘
 *   ORF    market O  OTC Reporting Facility — OTC / non-NMS equities, a
 *                    SEPARATE universe that the consolidated NMS tape excludes
 *
 * We sum every non-ORF facility, which reproduces FINRA's own consolidated
 * CNMS figure exactly. Verified 2026-08-25 against CNMSshvol20260821: GME on
 * 2026-08-21 sums to short 1,335,397.220545 / exempt 1,355 / total
 * 2,315,275.403735, byte-identical to the file's line (whose own market column
 * reads "B,Q,N"); market-wide that day, 12,269 symbols summing to short
 * 3,244,559,759 / total 6,564,367,888, also exact.
 *
 * That summation is the point. This pack previously read only FNSQ + FNYX and
 * a header comment asserted current data lived "exclusively" there. It does
 * not — NCTRF is a third NMS facility, and omitting it undercounted short
 * volume by 0.77% and total volume by 0.88% market-wide every day (measured on
 * the same file: 3,219,533,256 vs 3,244,559,759 short), silently, and by far
 * more on any symbol that trades disproportionately on Nasdaq Chicago. The
 * excluded ORF facility is deliberate and different: it is a different market,
 * not a missing part of this one, so `short_volume_daily` surfaces it as its
 * own labelled block rather than folding it into the NMS total.
 *
 * Publishing lag is typically T+1 or better (2026-08-25's file was queryable
 * on 2026-08-25). The default-date logic probes back up to 7 days for the most
 * recent day with published rows.
 *
 * Data sources:
 *   https://api.finra.org/data/group/otcMarket/name/regShoDaily
 *   https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest
 *   Field types: https://api.finra.org/metadata/group/otcMarket/name/regShoDaily
 *   Background: https://www.finra.org/finra-data/browse-catalog/short-sale-volume-daily
 *
 * LICENCE (fleet #531, #532, #1976). Every tool here reads the otcMarket
 * dataset group, which is covered by FINRA's Specific Terms for Equity Data
 * (https://developer.finra.org/specific-terms-equity-data, section 2.3). Two
 * conditions bind us and are NOT optional:
 *   - we must clearly identify FINRA as the owner and source of the data and
 *     of anything derived from it — hence the `attribution`/`license`/
 *     `license_note` fields attachLicense() puts on every result (built from
 *     EQUITY_DATA_LICENSE below, not hand-typed per response), which travel
 *     into ask_pipeworx answers because the answer path passes a pack's
 *     structuredContent through verbatim;
 *   - we may not charge any incremental fee for it — hence `zeroRated: true`
 *     AND `licence: 'non-commercial'` on the gateway's pack entry (the two
 *     are separate claims as of #1976: zeroRated is what we charge, licence
 *     is what the data carries regardless of price), which forces 0 credits
 *     for ALL FOUR tools and keeps the calls out of pricing-v2 bracket
 *     counting.
 * The endpoint answers keylessly, which is why nobody noticed a licence
 * attached. Keyless is not unencumbered. Do not remove either mechanism.
 *
 * Do NOT reintroduce a cdn.finra.org fetch, for a fallback or for freshness.
 * Those files are a different distribution outside the Specific Terms, and the
 * general FINRA.org Terms of Use that govern them instead are stricter: no
 * bulk copying of the website, no database creation from it, and an explicit
 * bar on use in conjunction with machine learning or AI software — which is
 * what every caller of this gateway is. Both routes carried 2026-08-21 on
 * 2026-08-25, so there is no freshness trade to make (fleet #532).
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'FINRA short-sale data');
}

const REGSHO_API = 'https://api.finra.org/data/group/otcMarket/name/regShoDaily';
const SI_API = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest';
const UA = 'pipeworx-mcp-finra/1.0 (+https://pipeworx.io)';

/** Largest page the Query API will return; asking for more is silently capped. */
const PAGE_SIZE = 5000;
/**
 * Backstop for the full-day ranking scan. A full day is ~28k rows (6 pages);
 * 24 pages is 120k, far above any real day. If we ever hit it we say so in the
 * response rather than returning a short ranking that looks complete.
 */
const MAX_PAGES = 24;

/**
 * The OTC Reporting Facility covers OTC / non-exchange-listed equities. It is
 * NOT part of the consolidated NMS tape, so it is excluded from `combined`
 * and reported separately. Everything else IS consolidated — expressed as an
 * exclusion rather than an allowlist of three so that a facility FINRA adds
 * later (the dataset metadata also documents `D` = ADF) is counted instead of
 * silently dropped, which is the exact bug this pack shipped with.
 */
const OTC_FACILITY = 'ORF';

const FACILITY_LABELS: Record<string, string> = {
  NQTRF: 'Nasdaq TRF Carteret',
  NYTRF: 'NYSE TRF',
  NCTRF: 'Nasdaq TRF Chicago',
  ORF: 'OTC Reporting Facility',
  ADF: 'Alternative Display Facility',
};

/**
 * Only the fields we use. The API honours a `fields` projection, which roughly
 * halves the payload on the full-day scan.
 */
const REGSHO_FIELDS = [
  'tradeReportDate',
  'securitiesInformationProcessorSymbolIdentifier',
  'shortParQuantity',
  'shortExemptParQuantity',
  'totalParQuantity',
  'marketCode',
  'reportingFacilityCode',
];

/**
 * Required by FINRA Specific Terms for Equity Data section 2.3 on the
 * api.finra.org otcMarket data every tool in this pack returns: FINRA must be
 * clearly identified as owner and source, including for derived data, and
 * End Users may not redistribute it further.
 *
 * Built from the shared LicenseTerms shape (fleet #1976) rather than a
 * bespoke local string — this was the ORIGINAL "hand-rolled inside one
 * pack" the task exists to fix, and `vendorTermsLicense`/`attachLicense` in
 * semanticscholar/core-research already use it) is the one mechanism now,
 * not a second one reinvented here.
 */
const EQUITY_DATA_LICENSE = vendorTermsLicense({
  ref: 'FINRA-Specific-Terms-Equity-Data-2.3',
  url: 'https://developer.finra.org/specific-terms-equity-data',
  attribution:
    'Source: FINRA. This data is owned by and sourced from FINRA (https://www.finra.org) and is provided '
    + 'under the FINRA API Specific Terms for Equity Data. Identify FINRA as the source in anything you '
    + 'derive from it. Permitted for non-commercial personal or professional use only; you may not '
    + 'redistribute it to third parties. Pipeworx charges nothing for this data.',
  obligations: ['attribution', 'non_commercial'],
});

interface ShortRow {
  date: string;
  symbol: string;
  short_volume: number;
  short_exempt_volume: number;
  total_volume: number;
  facility: string;
  market: string;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'short_volume_daily',
    description:
      'FINRA Reg SHO daily short-sale volume for one symbol on one trading day, summed across every consolidated-NMS reporting facility (Nasdaq TRF Carteret, NYSE TRF, Nasdaq TRF Chicago) so the total matches FINRA\'s consolidated CNMS figure. Returns short_volume, short_exempt_volume, total_volume, short_ratio (short / total), and the per-facility breakdown. Publishing lag is T+1 or better; omit `date` for the most recent published day. Zero-rated: FINRA\'s terms forbid charging for this data, so the call costs 0 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker (case-insensitive), e.g. "AAPL"' },
        date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD. Defaults to the most recent published trading day.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'short_volume_history',
    description:
      'FINRA Reg SHO daily short-sale volume time series for one symbol — up to 30 trading days ending at `end_date` (default: most recent published day). Each day carries short_volume, short_exempt_volume, total_volume and short_ratio summed across every consolidated-NMS reporting facility, so the daily totals match FINRA\'s consolidated CNMS figures. Use it to see how a symbol\'s short-sale share of volume moved over recent sessions. Zero-rated: costs 0 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker (case-insensitive)' },
        days: { type: 'number', description: '1–30 (default 10)' },
        end_date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD; defaults to most recent published day' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'short_volume_top',
    description:
      'Ranks symbols on a given trading day by short_ratio (short_volume / total_volume) using FINRA Reg SHO daily data summed across every consolidated-NMS reporting facility. Scans the whole published day (~12,000 symbols) and returns the highest-ratio names. Useful for spotting heavily-shorted names; raise min_total_volume to exclude thinly-traded micro-caps. Zero-rated: costs 0 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD; defaults to most recent published day' },
        limit: { type: 'number', description: '1–100 (default 25)' },
        min_total_volume: { type: 'number', description: 'Skip symbols below this consolidated total volume (default 100000)' },
      },
      required: [],
    },
  },
  {
    name: 'short_interest',
    description:
      'FINRA consolidated SHORT INTEREST for one symbol — the bi-monthly settlement-date data: total open short position, days-to-cover, average daily volume, and change vs the prior settlement. This is the "% short / days-to-cover" metric investors cite — DISTINCT from short_volume_daily (daily short-sale VOLUME). Returns the latest settlement plus recent history, plus the FINRA attribution the data is licensed under. Zero-rated: FINRA\'s terms forbid charging for it, so this call costs 0 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker (case-insensitive), e.g. "TSLA"' },
        limit: { type: 'number', description: 'How many recent settlements to return (1–24, default 6)' },
      },
      required: ['symbol'],
    },
  },
];

/**
 * Attribution is attached HERE, via attachLicense(), not in each handler and
 * not as a hand-typed string (fleet #1976 — this was the original "hand-
 * rolled inside one pack" case the split-flag task named), because FINRA's
 * terms bind every response including the ones that carry no data — a
 * soft-fail shape is still "Resultant Data derived therefrom". Centralising
 * it means a new tool or a new early-return cannot ship unattributed by
 * omission. attachLicense leads the object with `attribution`/`license`/
 * `license_note` so the credit is the first thing a synthesising model
 * reads. Every tool in this pack now reads the same licensed dataset group,
 * so there is one EQUITY_DATA_LICENSE and no per-tool branch to get wrong.
 */
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await dispatch(name, args);
  return attachLicense(result, EQUITY_DATA_LICENSE);
}

async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'short_volume_daily':
      return shortVolumeDaily(args);
    case 'short_volume_history':
      return shortVolumeHistory(args);
    case 'short_volume_top':
      return shortVolumeTop(args);
    case 'short_interest':
      return shortInterest(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Query API transport
// ---------------------------------------------------------------------------

/**
 * One page of a FINRA Query API dataset.
 *
 * Three upstream behaviours this has to absorb, each of which reads as
 * something else if you skip it:
 *   - `record-total` is the count matching the FILTERS, not the page, and the
 *     server caps `limit` at 5,000 silently. Without reading the header a
 *     truncated scan looks exactly like a complete answer.
 *   - a query matching NOTHING answers **204 with an empty body**, not `[]`,
 *     so res.json() throws a JSON parse error — which surfaces as "the pack is
 *     broken" when the truth is "that day has no data yet". Empty means empty.
 *   - `Accept: application/json` is mandatory; omit it and FINRA returns CSV,
 *     which then fails to parse for a completely unrelated reason.
 */
async function queryPage(
  url: string,
  body: Record<string, unknown>,
): Promise<{ rows: Array<Record<string, unknown>>; recordTotal: number | null }> {
  const res = await pwFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
  });
  const header = res.headers.get('record-total');
  const recordTotal = header !== null && header !== '' && Number.isFinite(Number(header)) ? Number(header) : null;
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`FINRA Query API error: HTTP ${res.status} ${detail}`);
  }
  const text = await res.text();
  if (res.status === 204 || text.trim() === '') return { rows: [], recordTotal: recordTotal ?? 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`FINRA Query API returned an unparseable body: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`FINRA Query API returned a non-array body: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return { rows: parsed as Array<Record<string, unknown>>, recordTotal };
}

/**
 * Symbol case is PRESERVED, never normalised. A lowercase letter is FINRA's
 * preferred-share marker: on 2026-08-21 `BCpC` (Bancorp preferred series C,
 * 2,267 shares) and `BCPC` (Balchem common, 52,413) are two different
 * securities in the same file, as are `TpC` and `TPC`. Upper-casing merges
 * them and hands back a total for a security that does not exist.
 */
function toRow(r: Record<string, unknown>): ShortRow | null {
  const symbol = String(r.securitiesInformationProcessorSymbolIdentifier ?? '');
  const short = Number(r.shortParQuantity);
  const total = Number(r.totalParQuantity);
  if (!symbol || !Number.isFinite(short) || !Number.isFinite(total)) return null;
  const exempt = Number(r.shortExemptParQuantity);
  return {
    date: String(r.tradeReportDate ?? ''),
    symbol,
    short_volume: short,
    short_exempt_volume: Number.isFinite(exempt) ? exempt : 0,
    total_volume: total,
    facility: String(r.reportingFacilityCode ?? ''),
    market: String(r.marketCode ?? ''),
  };
}

function isConsolidatedNms(row: ShortRow): boolean {
  return row.facility !== OTC_FACILITY;
}

/**
 * Pick which security the caller meant.
 *
 * The Query API's `equal` filter is CASE-INSENSITIVE — asking for "BCPC"
 * returns the rows for `BCPC` AND for `BCpC`, which are a common stock and a
 * preferred series. Summing whatever comes back produces a confident total for
 * a security that does not exist, and it returns 200, so nothing anywhere
 * would say so. Hence: resolve to exactly one symbol, or refuse and say why.
 */
type SymbolSelection =
  | { ok: true; symbol: string; rows: ShortRow[]; alternates: string[] }
  | { ok: false; softFail: Record<string, unknown> };

function selectSymbol(rows: ShortRow[], requested: string): SymbolSelection {
  const distinct = Array.from(new Set(rows.map((r) => r.symbol)));
  if (distinct.length <= 1) {
    return { ok: true, symbol: distinct[0] ?? requested.toUpperCase(), rows, alternates: [] };
  }
  const exact = distinct.find((sym) => sym === requested);
  if (exact !== undefined) {
    return {
      ok: true,
      symbol: exact,
      rows: rows.filter((r) => r.symbol === exact),
      alternates: distinct.filter((sym) => sym !== exact),
    };
  }
  return {
    ok: false,
    softFail: {
      found: false,
      symbol: requested,
      reason: 'ambiguous_symbol',
      candidates: distinct,
      hint: `FINRA reports ${distinct.length} distinct symbols matching "${requested}" case-insensitively: ${distinct.join(', ')}. A lowercase letter is FINRA's preferred-share marker — e.g. "BCpC" is a preferred series and "BCPC" the common stock, different securities whose volumes must not be added. Re-call with the exact symbol, matching case.`,
    },
  };
}

/** Rows for one symbol on one day — at most a handful, so one page suffices. */
async function fetchSymbolDay(symbol: string, date: string): Promise<ShortRow[]> {
  const { rows } = await queryPage(REGSHO_API, {
    limit: 50,
    fields: REGSHO_FIELDS,
    compareFilters: [
      { fieldName: 'securitiesInformationProcessorSymbolIdentifier', fieldValue: symbol, compareType: 'equal' },
      { fieldName: 'tradeReportDate', fieldValue: date, compareType: 'equal' },
    ],
  });
  return rows.map(toRow).filter((r): r is ShortRow => r !== null);
}

/**
 * Rows for one symbol across a date range, in ONE request. This is why history
 * is cheap now: the old file-per-day route cost up to 60 fetches for 30 days.
 * `dateRangeFilters` needs no sort (the API refuses sorting unless the
 * partition key is an EQUAL filter), so we order by date ourselves.
 */
async function fetchSymbolRange(symbol: string, startDate: string, endDate: string): Promise<ShortRow[]> {
  const out: ShortRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, recordTotal } = await queryPage(REGSHO_API, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      fields: REGSHO_FIELDS,
      compareFilters: [
        { fieldName: 'securitiesInformationProcessorSymbolIdentifier', fieldValue: symbol, compareType: 'equal' },
      ],
      dateRangeFilters: [{ fieldName: 'tradeReportDate', startDate, endDate }],
    });
    for (const raw of rows) {
      const row = toRow(raw);
      if (row) out.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
    if (recordTotal !== null && (page + 1) * PAGE_SIZE >= recordTotal) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

async function shortVolumeDaily(args: Record<string, unknown>) {
  const requested = reqStr(args, 'symbol', '"AAPL"').trim();
  const resolved = await resolveDate(args.date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  const rows = await fetchSymbolDay(requested, resolved.date);
  if (rows.length === 0) {
    return {
      found: false,
      symbol: requested.toUpperCase(),
      date: resolved.date,
      reason: 'symbol_not_reported',
      hint: `No FINRA Reg SHO rows for ${requested.toUpperCase()} on ${resolved.date}. This is normal for a symbol with no FINRA-reported volume that day; try another date, or use short_volume_history to see when the symbol last had data.`,
    };
  }
  const picked = selectSymbol(rows, requested);
  if (!picked.ok) return { ...picked.softFail, date: resolved.date };
  return withAlternates(summarize(picked.symbol, resolved.date, picked.rows), picked.alternates);
}

async function shortVolumeHistory(args: Record<string, unknown>) {
  const requested = reqStr(args, 'symbol', '"AAPL"').trim();
  const days = clamp(toNum(args.days, 10), 1, 30);
  const resolved = await resolveDate(args.end_date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  // Calendar span wide enough that `days` TRADING days fit inside it even
  // across a holiday week: ~7 calendar days per 5 trading days, plus slack.
  const startDate = shiftDays(resolved.date, -Math.ceil(days * 1.6) - 7);
  const rows = await fetchSymbolRange(requested, startDate, resolved.date);
  const picked = selectSymbol(rows, requested);
  if (!picked.ok) return { ...picked.softFail, end_date: resolved.date };
  const symbol = picked.symbol;

  const byDate = new Map<string, ShortRow[]>();
  for (const row of picked.rows) {
    if (!row.date || row.date > resolved.date) continue;
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }
  const series = Array.from(byDate.keys())
    .sort((a, b) => b.localeCompare(a))
    .slice(0, days)
    .map((date) => summarize(symbol, date, byDate.get(date)!));

  return {
    symbol,
    ...(picked.alternates.length > 0 ? { also_reported: picked.alternates } : {}),
    end_date: resolved.date,
    days_returned: series.length,
    days_requested: days,
    series,
    ...(series.length < days
      ? {
          note: `Only ${series.length} published trading day(s) found in the ${startDate}..${resolved.date} window. FINRA publishes on trading days only, so holidays and a symbol's own quiet days both shorten this.`,
        }
      : {}),
  };
}

async function shortVolumeTop(args: Record<string, unknown>) {
  const limit = clamp(toNum(args.limit, 25), 1, 100);
  const minVol = Math.max(0, toNum(args.min_total_volume, 100_000));
  const resolved = await resolveDate(args.date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  // Aggregate page by page and drop the raw rows: a full day is ~28k rows and
  // holding them all before reducing is the shape that runs a worker out of
  // memory on a heavy day.
  const bySym = new Map<string, { short: number; exempt: number; total: number }>();
  let scanned = 0;
  let recordTotal: number | null = null;
  let complete = false;
  let pages = 0;

  for (; pages < MAX_PAGES; pages++) {
    const page = await queryPage(REGSHO_API, {
      limit: PAGE_SIZE,
      offset: pages * PAGE_SIZE,
      fields: REGSHO_FIELDS,
      compareFilters: [{ fieldName: 'tradeReportDate', fieldValue: resolved.date, compareType: 'equal' }],
    });
    if (recordTotal === null) recordTotal = page.recordTotal;
    for (const raw of page.rows) {
      scanned++;
      const row = toRow(raw);
      if (!row || !isConsolidatedNms(row)) continue;
      const cur = bySym.get(row.symbol);
      if (cur) {
        cur.short += row.short_volume;
        cur.exempt += row.short_exempt_volume;
        cur.total += row.total_volume;
      } else {
        bySym.set(row.symbol, { short: row.short_volume, exempt: row.short_exempt_volume, total: row.total_volume });
      }
    }
    if (page.rows.length < PAGE_SIZE) {
      complete = true;
      break;
    }
    if (recordTotal !== null && scanned >= recordTotal) {
      complete = true;
      break;
    }
  }

  const ranked = Array.from(bySym.entries())
    .filter(([, v]) => v.total >= minVol)
    .map(([symbol, v]) => ({
      symbol,
      short_volume: v.short,
      short_exempt_volume: v.exempt,
      total_volume: v.total,
      short_ratio: v.total > 0 ? v.short / v.total : 0,
    }))
    .sort((a, b) => b.short_ratio - a.short_ratio)
    .slice(0, limit);

  return {
    date: resolved.date,
    min_total_volume: minVol,
    scope: 'consolidated_nms',
    symbols_considered: bySym.size,
    symbols_returned: ranked.length,
    rows_scanned: scanned,
    facility_rows_available: recordTotal,
    complete,
    top: ranked,
    note: complete
      ? 'Ranked over the full published day. Volumes are summed across the consolidated-NMS reporting facilities (Nasdaq TRF Carteret, NYSE TRF, Nasdaq TRF Chicago), matching FINRA\'s consolidated CNMS figures. OTC Reporting Facility (ORF) rows cover non-NMS OTC securities and are ranked separately from this NMS universe, so they are excluded here.'
      : `Ranking is INCOMPLETE: stopped after ${pages + 1} pages (${scanned} of ${recordTotal ?? 'unknown'} facility rows) to stay inside the request budget, so a qualifying symbol may be missing. Narrow the day or raise min_total_volume.`,
  };
}

async function shortInterest(args: Record<string, unknown>) {
  const symbol = reqStr(args, 'symbol', '"TSLA"').toUpperCase();
  const limit = clamp(toNum(args.limit, 6), 1, 24);
  const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10); // ~13mo of bi-monthly settlements
  const end = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const { rows } = await queryPage(SI_API, {
    limit: 60,
    compareFilters: [{ fieldName: 'symbolCode', compareType: 'equal', fieldValue: symbol }],
    dateRangeFilters: [{ fieldName: 'settlementDate', startDate: start, endDate: end }],
  });
  if (!rows.length) return { symbol, count: 0, note: 'No consolidated short-interest records in the last ~13 months (bi-monthly settlements). Check the ticker, or the security may not be FINRA-reported.' };
  rows.sort((a, b) => String(b.settlementDate).localeCompare(String(a.settlementDate)));
  const map = (r: Record<string, unknown>) => {
    const cur = Number(r.currentShortPositionQuantity), prev = Number(r.previousShortPositionQuantity);
    return {
      settlement_date: r.settlementDate,
      short_interest: cur,
      previous_short_interest: prev,
      change: Number(r.changePreviousNumber),
      change_pct: prev ? +(((cur - prev) / prev) * 100).toFixed(2) : null,
      days_to_cover: Number(r.daysToCoverQuantity),
      avg_daily_volume: Number(r.averageDailyVolumeQuantity),
      market: r.marketClassCode,
    };
  };
  return {
    symbol,
    issue_name: rows[0].issueName ?? null,
    latest: map(rows[0]),
    history: rows.slice(0, limit).map(map),
    note: 'FINRA consolidated short interest (bi-monthly, by settlement date). Distinct from short_volume_daily (daily short-sale volume).',
  };
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/**
 * Name the near-miss symbols we deliberately did NOT sum in, so a caller who
 * meant the preferred series can see it exists rather than reading our total
 * as the whole story.
 */
function withAlternates<T extends Record<string, unknown>>(result: T, alternates: string[]) {
  if (alternates.length === 0) return result;
  return {
    ...result,
    also_reported: alternates,
    symbol_note: `FINRA also reports ${alternates.join(', ')} on this date, which differ from the requested symbol only by letter case (FINRA's preferred-share marker). Those are separate securities and are excluded from the figures above.`,
  };
}

/**
 * `combined` is the consolidated-NMS sum, which is the number a caller means by
 * "short volume" and the one that reconciles with FINRA's CNMS file. ORF rows
 * are kept but reported apart: a symbol quoted OTC is a different market, and
 * folding it in would inflate an NMS total, while dropping it silently would
 * hand back a zero for a security that genuinely traded.
 */
function summarize(symbol: string, date: string, rows: ShortRow[]) {
  const nms = rows.filter(isConsolidatedNms);
  const otc = rows.filter((r) => !isConsolidatedNms(r));
  const primary = nms.length > 0 ? nms : otc;
  const totals = primary.reduce(
    (acc, r) => {
      acc.short_volume += r.short_volume;
      acc.short_exempt_volume += r.short_exempt_volume;
      acc.total_volume += r.total_volume;
      return acc;
    },
    { short_volume: 0, short_exempt_volume: 0, total_volume: 0 },
  );
  const describe = (r: ShortRow) => ({
    trf_code: r.facility,
    trf_label: FACILITY_LABELS[r.facility] ?? r.facility,
    market_code: r.market,
    short_volume: r.short_volume,
    short_exempt_volume: r.short_exempt_volume,
    total_volume: r.total_volume,
  });
  return {
    symbol,
    date,
    scope: nms.length > 0 ? 'consolidated_nms' : 'otc_reporting_facility',
    combined: {
      ...totals,
      short_ratio: totals.total_volume > 0 ? totals.short_volume / totals.total_volume : 0,
    },
    by_trf: primary.map(describe),
    ...(nms.length > 0 && otc.length > 0
      ? {
          otc_reporting_facility: otc.map(describe),
          note: 'combined is the consolidated-NMS total (matches FINRA\'s CNMS figure). The symbol also had OTC Reporting Facility volume, listed separately under otc_reporting_facility because ORF covers non-NMS OTC trading and the consolidated NMS tape excludes it.',
        }
      : {}),
    ...(nms.length === 0 && otc.length > 0
      ? {
          note: 'This symbol had no consolidated-NMS volume on this date; the figures above are from FINRA\'s OTC Reporting Facility (ORF), which covers OTC / non-exchange-listed equities. Read them as OTC volume, separate from the consolidated NMS tape.',
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Normalise YYYY-MM-DD or YYYYMMDD to the API's YYYY-MM-DD; with no input,
 * walk back up to 7 days for the most recent day carrying published rows. The
 * probe asks for a single row with a one-field projection, so a miss costs
 * almost nothing.
 */
async function resolveDate(input: string | undefined): Promise<
  | { ok: true; date: string }
  | { ok: false; softFail: { found: false; reason: string; hint: string } }
> {
  if (input && input.trim()) {
    const digits = input.replace(/-/g, '');
    if (!/^\d{8}$/.test(digits)) {
      return {
        ok: false,
        softFail: {
          found: false,
          reason: 'invalid_date',
          hint: `date must be YYYY-MM-DD or YYYYMMDD; got "${input}"`,
        },
      };
    }
    return { ok: true, date: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` };
  }
  let cursor = todayUtc();
  for (let i = 0; i < 7; i++) {
    if (isWeekday(cursor)) {
      const { rows } = await queryPage(REGSHO_API, {
        limit: 1,
        fields: ['tradeReportDate'],
        compareFilters: [{ fieldName: 'tradeReportDate', fieldValue: cursor, compareType: 'equal' }],
      });
      if (rows.length > 0) return { ok: true, date: cursor };
    }
    cursor = shiftDays(cursor, -1);
  }
  return {
    ok: false,
    softFail: {
      found: false,
      reason: 'no_recent_data',
      hint: 'No published FINRA Reg SHO data in the last 7 days. Publishing lag is normally T+1 or better; pass `date` explicitly with a YYYY-MM-DD you know to be a recent trading day.',
    },
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isWeekday(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
