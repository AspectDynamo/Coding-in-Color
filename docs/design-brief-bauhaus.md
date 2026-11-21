# Design Brief — Bauhaus Redesign (binding)

Owner: lead (creative director). Implementer: `frontend-fable` only. This brief **supersedes** the earlier claymorphism direction and the images in `docs/design-references/` (keep them only as a record of what we are moving away from).

## Mission

A complete redesign — not a re-theme. Reimagine visual identity, page composition, component system, typography, navigation, information hierarchy and interaction design. Result: a carefully art-directed education-technology platform that looks **designed, not generated** — recognizable from a screenshot without its logo.

Character: intellectual, creative, educational, modernist, confident, purposeful, human, memorable. It must communicate learning, creativity, logic, experimentation and measurable progress.

Mental model: **a premium digital education publication combined with a modern learning-analytics platform.** Bauhaus graphic design × Swiss / International Typographic Style × modernist editorial layout × contemporary educational publishing. A modern digital interpretation — not a literal historical poster.

## Principles

Form follows function · geometric simplicity · strong composition · functional typography · asymmetrical balance · clear hierarchy · primary-color relationships · mathematical spacing · repetition and rhythm · communication through shapes. "Bauhaus" is **not** "use red, yellow, blue and circles" — it is compositional discipline.

## Color

| Token          | Start value | Use                   |
| -------------- | ----------- | --------------------- |
| Warm paper     | `#F4F0E7`   | main background       |
| Light paper    | `#FBF9F3`   | content surfaces      |
| Ink black      | `#20201E`   | main text, hierarchy  |
| Border ink     | `#D4CFC3`   | dividers, borders     |
| Bauhaus red    | `#D94335`   | primary accent        |
| Geometric blue | `#315FA8`   | secondary accent      |
| Signal yellow  | `#E9BE43`   | highlights            |
| Muted sage     | `#8D9B83`   | secondary information |

Refine for accessibility. Warm neutrals dominate, black sets hierarchy, red/blue/yellow are used intentionally and carry meaning. No large arbitrary gradients, no pastel-gradient AI look, not every accent on every screen, not the same treatment on every card. Define semantic success / warning / error / info / disabled / focus that fit the palette. Text contrast AA (note: red/yellow/sage on paper may fail for small text — use darker text variants where needed; yellow is never a text color on paper).

## Typography (a headline feature)

Strong contemporary sans for headings + body (explore Space Grotesk, IBM Plex Sans, Inter, DM Sans, Manrope, Archivo) and a restrained mono (e.g. IBM Plex Mono) for assessment identifiers, code, data labels, technical metadata, score annotations. Self-host fonts (privacy — no font CDNs). Deliberate hierarchy: large editorial page titles → strong section heads → module heads → readable body → small-but-legible metadata → mono numerals/technical labels. Vary size and weight for rhythm; not every heading identical; not everything bold; metadata not too small. Typography distinguishes learning content from administrative data.

## Geometry & composition

Controlled vocabulary: circles, semicircles, rectangles, squares, thin lines, grids, geometric divisions, overlapping shapes where compositionally right, numbered geometric markers. Shapes must support hierarchy and identity — never random floating decoration.
Composition: asymmetric layouts, editorial grid, strong alignment, intentional whitespace, contrasting proportions, distinct content zones, large typographic anchors, geometric separators. Not every element in an identical rounded rectangle — use flat surfaces, thin borders, color blocks, occasional elevation.
Corners: mostly square or subtly rounded surfaces, consistent modest radii, rectangular compositions, thin deliberate borders; occasional circular controls/badges. Buttons may be subtly rounded; nothing inflated or bubbly; no pervasive pills.

## Identity

Original simple geometric brand mark + restrained wordmark; consistent icon system (Lucide for functional icons; no emoji as UI icons); a distinctive assessment progress indicator; a recognizable data-viz style; reusable geometric motifs; original CSS/SVG geometric illustrations where appropriate.

## Layouts

Coherent editorial grid. Revisit navigation, sidebar/top nav, content width, page headers, breadcrumbs, grids, tables, charts, forms, modals, empty and loading states — do not keep the old structure under new paint.

- **Admin:** distinct navigation, clean top-level heading, contextual info, strong section separation, deliberate KPI arrangement, well-composed analytics, clear filters, visible reporting workflow. Not a SaaS admin template.
- **Student:** more expressive and approachable — learning, progress, achievement, curiosity, simplicity. Minimal navigation. The assessment stays extremely easy.
- **Instructor:** efficient, uncluttered — sessions, cohort selection, assessment assignment, participation, completion.

## Pages (every page; none may keep the old language)

1. **Student landing / access:** memorable welcome; strong type; geometric hero composition; clear instructions; prominent access-code field; one obvious primary action; subtle educational motifs. No gradient hero, blobs, overly rounded inputs, marketing filler.
2. **Assessment (critical):** focused workbook-like environment; clear question hierarchy; large readable question text; distinct answers; obvious selected state; strong geometric progress indicator (e.g. numbered geometric blocks / segmented bar); clear prev/next; keyboard accessible; clear submit confirmation. Not a generic survey.
3. **Completion:** clear success heading, saved confirmation, geometric completion illustration, encouraging educational language, clear next action. No confetti/childish effects.
4. **Instructor dashboard:** editorial header, structured session cards, clear cohort labels, strong status indicators, good action buttons, organized assessment lists, participation overview; key actions discoverable.
5. **Admin overview (most attention):** educational research / impact-reporting environment. Strong heading; elegant compact filter row; 2–3 prominent impact statistics; a large dominant pre/post comparison; smaller supporting metrics; skill-level analysis; program/cohort comparison; recent activity; visible AI reporting action. **No grid of eight identical cards.** Varying widths and weights to establish hierarchy.
6. **Student progress detail:** a learning progress record (not a CRM profile): prominent pseudonymous id, chronological assessment timeline, score progression, skill strengths, areas needing improvement, history.
7. **Programs & cohorts:** organized tables and editorial lists rather than card grids; labels, status, dates, counts, completion, filters, obvious management actions.
8. **Assessment management:** structured authoring editor (details, questions, types, skill tags, difficulty, scoring, stages, preview mode), not a pile of inputs.
9. **AI reporting:** an analytical writing assistant: report context, program/cohort, period, source metrics, generate, narrative, key findings, recommendations, limitations, copy/export. AI output visually distinct from verified source metrics and clearly labelled as AI-generated.
   Also: staff login + MFA, instructor session/cohort/cards, consent, staff, audit, saved reports, printable report, 404/403.

## Data visualization

Simple, purposeful, readable: restrained color, strong labels, axis titles, consistent type, minimal chrome, thin grid lines, distinct pre/post colors, clear legends. **Baseline = geometric blue, Final = Bauhaus red, neutral reference = ink/sage, highlight = yellow.** No rainbow palettes, no decorative charts. Communicate baseline, post, percentage-point change, matched n, improvement distribution. **Never exaggerate by manipulating axes** (score axes 0–100).

## Motion

Short transitions, subtle hover, clear focus, controlled page transitions, small progress animations, press feedback, smooth chart rendering. No springy, floating, looping or scroll-triggered decoration. Respect `prefers-reduced-motion`.

## Responsive

Large desktop, laptop, tablet, mobile — recompose, don't shrink. Mobile: simplified nav, readable charts, tables scroll or become structured lists, comfortable tap targets, no horizontal overflow, readable type, actions reachable. Student assessment is the mobile priority.

## Accessibility

WCAG 2.2 AA: contrast, keyboard, visible focus, semantic HTML, labels, screen-reader-friendly controls, clear errors, ARIA only where needed, reduced motion, non-color status indicators.

## Technical constraints

Frontend transformation only. Preserve API contracts (`src/shared`), credential workflows, submission, scoring, permissions, data retrieval, AI reporting, routes where possible. No mock data, no placeholder buttons, no removing working features without approval. Backend/schema changes only if a real integration issue requires it and the lead approves.

## Design system

Tokens: colors, typography, spacing, grid, borders, shadows, radii, motion, z-index, breakpoints. Components with one consistent API: buttons, inputs, selects, navigation, sidebars, tables, cards, metric displays, status labels, modals, tooltips, charts, assessment questions, progress indicators, empty states, notifications. No duplicated near-variants.

## Acceptance (reviewed by the lead from screenshots)

Recognizable identity · strong typographic hierarchy · consistent geometric language · purposeful color · sophisticated composition · consistent spacing · clear educational context · excellent chart readability · accessible interactions · responsive · no template look · no excessive decoration · no inconsistent components. Student = welcoming and educational; admin = analytical and polished; instructor = efficient and practical. Pages that look like a generic AI dashboard are rejected.
