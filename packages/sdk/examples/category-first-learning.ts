/**
 * Agent integration steps. Selection and writing are callbacks implemented by the
 * composing agent; stored usage counts never substitute for semantic judgment.
 */
import { Extrovert, ApiError, type Category, type LearnReviewRuleRequest } from "@extrovert.dev/sdk";

export async function prepareComposition(
  client: Extrovert,
  choose: (categories: Category[]) => Promise<Category | undefined>,
  propose: () => Promise<{ name: string; description: string }>,
  signal?: AbortSignal,
) {
  let page: string | undefined;
  const seen = new Set<string>();
  // Bounded discovery: fail visibly rather than interpreting truncation as no fit.
  for (let step = 0; step < 100; step++) {
    const categories = await client.categories.list({ sort: "popular", limit: 100, page }, signal);
    const match = await choose(categories.items);
    if (match) return { category: match, rules: await client.rules.get({ category_id: match.id }, signal) };
    if (!categories.next_cursor) {
      try {
        const category = await client.categories.propose(await propose(), signal);
        return { category, rules: await client.rules.get({ category_id: category.id }, signal) };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        // Another composer created this name. Reconcile the registry again.
        page = undefined;
        seen.clear();
        continue;
      }
    }
    if (seen.has(categories.next_cursor)) throw new Error("Repeated category cursor");
    seen.add(categories.next_cursor);
    page = categories.next_cursor;
  }
  throw new Error("Category discovery exceeded 10,000 candidates; narrow the task before proposing another category");
}

export async function learnAuthenticatedFeedback(
  client: Extrovert,
  reviewId: string,
  input: LearnReviewRuleRequest,
  signal?: AbortSignal,
) {
  // Read the original human source via reviews.feedback/turns first. For any
  // reusable reviewer correction, use this method at the intended scope.
  // An equivalent project rule cannot satisfy an org_house instruction.
  const learned = await client.rules.learnFromReview(reviewId, input, signal);
  // Verify the returned scope/source before retiring a redundant narrower rule.
  // Refresh rules and revise the SAME review, acknowledge successfully handled
  // events, then keep one shared wait until confirmed sent or terminal.
  return learned;
}
