// #3720 Completion Wave 4 — the server-owned Mingla Avengers adapter.
//
// This module deliberately accepts only the separately reviewed public-safe
// Product fields. Support sources, customer identities and private evidence are
// not part of any type or request assembled here.

export const AVENGERS_PROJECT_ID = "PVT_kwDOD8Prls4BdV8K";
export const AVENGERS_PROJECT_NUMBER = 4;
export const AVENGERS_OWNER = "Mingla-LLC";
export const AVENGERS_REPO = "mingla-main";
export const AVENGERS_REPOSITORY = `${AVENGERS_OWNER}/${AVENGERS_REPO}`;

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_URL = "https://api.github.com";
const USER_AGENT = "mingla-product-avengers/3720";

export type PublicProductReview = {
  signal_id: string;
  public_title: string;
  public_problem_statement: string;
  public_outcome: string;
  public_acceptance_criteria: string[];
  board_work_type: "Bug" | "Initiative";
  board_product: "Business" | "Explorer" | "Both" | "Platform";
  board_theme: string;
  board_priority: "P0" | "P1" | "P2" | "P3";
  board_estimate: "1" | "2" | "3" | "5" | "8" | "13";
  board_horizon: "Now" | "Next" | "Later";
  board_quarter: string;
};

export type CandidateIssue = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
};

export type AvengersSnapshot = {
  repository: typeof AVENGERS_REPOSITORY;
  issue_number: number;
  issue_node_id: string;
  project_item_id: string;
  issue_url: string;
  issue_title: string;
  issue_state: "OPEN" | "CLOSED";
  issue_updated_at: string;
  board_status: string;
  board_work_type: string;
  board_product: string;
  board_theme: string;
  board_priority: string;
  board_estimate: string;
  board_horizon: string;
  board_quarter: string;
  board_refined: string;
  board_sprint: string;
};

type Fetcher = typeof fetch;
type Json = Record<string, unknown>;

export type RepositoryPinnedSource = {
  commit: string;
  path: string;
};

function stableError(code: string): Error {
  return new Error(code);
}

function publicSearchTerms(review: PublicProductReview): string {
  const stop = new Set([
    "about",
    "after",
    "again",
    "being",
    "could",
    "from",
    "have",
    "into",
    "that",
    "their",
    "there",
    "these",
    "this",
    "when",
    "where",
    "with",
    "would",
  ]);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (
    const token of `${review.public_title} ${review.board_theme}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
  ) {
    if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length === 8) break;
  }
  return terms.join(" ");
}

export function buildCandidateSearchQuery(review: PublicProductReview): string {
  const terms = publicSearchTerms(review);
  return `repo:${AVENGERS_REPOSITORY} is:issue ${
    terms || review.board_work_type
  }`;
}

export function buildIssueBody(review: PublicProductReview): string {
  const criteria = review.public_acceptance_criteria.map((item) =>
    `- [ ] ${item.trim()}`
  ).join("\n");
  return [
    "## Problem",
    review.public_problem_statement.trim(),
    "",
    "## Intended outcome",
    review.public_outcome.trim(),
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "---",
    "Created from a human-reviewed Mingla Product Inbox signal.",
    `<!-- mingla-product-signal:${review.signal_id} -->`,
  ].join("\n");
}

export function publicSignalMarker(signalId: string): string {
  return `mingla-product-signal:${signalId}`;
}

function fieldName(node: Json): string {
  const field = node.field as Json | undefined;
  return typeof field?.name === "string" ? field.name : "";
}

function fieldText(node: Json): string {
  for (const key of ["name", "title", "text", "date"]) {
    if (typeof node[key] === "string") return node[key] as string;
  }
  if (typeof node.number === "number") return String(node.number);
  return "";
}

export class ProductAvengersClient {
  constructor(private token: string, private fetcher: Fetcher = fetch) {
    if (!token) throw stableError("GITHUB_TOKEN_MISSING");
  }

  private async rest(method: string, path: string, body?: Json): Promise<Json> {
    const response = await this.fetcher(`${REST_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({})) as Json;
    if (!response.ok) throw stableError(`GITHUB_REST_${response.status}`);
    return json;
  }

  private async graphql(query: string, variables: Json): Promise<Json> {
    const response = await this.fetcher(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await response.json().catch(() => ({})) as Json;
    if (!response.ok || Array.isArray(json.errors)) {
      throw stableError("GITHUB_GRAPHQL_FAILED");
    }
    return (json.data as Json | undefined) ?? {};
  }

  private async repositoryTree(ref: string): Promise<Map<string, string>> {
    const json = await this.rest(
      "GET",
      `/repos/${AVENGERS_REPOSITORY}/git/trees/${
        encodeURIComponent(ref)
      }?recursive=1`,
    );
    if (json.truncated === true || !Array.isArray(json.tree)) {
      throw stableError("GITHUB_TREE_INCOMPLETE");
    }
    const blobs = new Map<string, string>();
    for (const item of json.tree as Json[]) {
      if (
        item.type === "blob" && typeof item.path === "string" &&
        typeof item.sha === "string"
      ) {
        blobs.set(item.path, item.sha);
      }
    }
    return blobs;
  }

  async changedPinnedSources<T extends RepositoryPinnedSource>(
    sources: T[],
  ): Promise<T[]> {
    if (sources.length === 0) return [];
    const current = await this.repositoryTree("main");
    const pinnedTrees = new Map<string, Map<string, string>>();
    for (const commit of new Set(sources.map((source) => source.commit))) {
      pinnedTrees.set(commit, await this.repositoryTree(commit));
    }
    return sources.filter((source) => {
      const pinned = pinnedTrees.get(source.commit)?.get(source.path);
      const latest = current.get(source.path);
      return !pinned || pinned !== latest;
    });
  }

  async ensureIssueComment(
    issueNumber: number,
    marker: string,
    body: string,
  ): Promise<string> {
    const data = await this.graphql(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            comments(last: 100) { nodes { databaseId body } }
          }
        }
      }
    `,
      { owner: AVENGERS_OWNER, repo: AVENGERS_REPO, number: issueNumber },
    );
    const repository = data.repository as Json | undefined;
    const issue = repository?.issue as Json | undefined;
    const comments = issue?.comments as Json | undefined;
    const nodes = Array.isArray(comments?.nodes)
      ? comments.nodes as Json[]
      : [];
    const existing = nodes.find((node) =>
      typeof node.body === "string" && node.body.includes(marker)
    );
    if (existing?.databaseId != null) return String(existing.databaseId);
    const created = await this.rest(
      "POST",
      `/repos/${AVENGERS_REPOSITORY}/issues/${issueNumber}/comments`,
      { body },
    );
    if (created.id == null) throw stableError("GITHUB_COMMENT_INVALID");
    return String(created.id);
  }

  async searchIssues(review: PublicProductReview): Promise<CandidateIssue[]> {
    const query = encodeURIComponent(buildCandidateSearchQuery(review));
    const json = await this.rest(
      "GET",
      `/search/issues?q=${query}&per_page=10`,
    );
    const items = Array.isArray(json.items) ? json.items as Json[] : [];
    return items
      .filter((item) => !item.pull_request)
      .map((item) => ({
        number: Number(item.number),
        title: String(item.title ?? ""),
        url: String(item.html_url ?? ""),
        state:
          (String(item.state ?? "open").toUpperCase() === "CLOSED"
            ? "CLOSED"
            : "OPEN") as "OPEN" | "CLOSED",
      }))
      .filter((item) =>
        Number.isInteger(item.number) && item.number > 0 && item.title &&
        item.url
      );
  }

  async findIssueForSignal(signalId: string): Promise<number | null> {
    const marker = publicSignalMarker(signalId);
    // The repository issue list is immediately consistent after creation,
    // unlike GitHub search indexing. Checking it first closes the retry window
    // between creating an issue and committing the local bridge snapshot.
    const recent = await this.rest(
      "GET",
      `/repos/${AVENGERS_REPOSITORY}/issues?state=all&sort=created&direction=desc&per_page=100`,
    );
    const recentItems = Array.isArray(recent) ? recent as Json[] : [];
    const recentExact = recentItems.find((item) =>
      !item.pull_request && Number(item.number) > 0 &&
      typeof item.body === "string" && item.body.includes(marker)
    );
    if (recentExact) return Number(recentExact.number);

    // Indexed search covers an older linked issue outside the recent window.
    const query = encodeURIComponent(
      `repo:${AVENGERS_REPOSITORY} is:issue in:body \"${marker}\"`,
    );
    const json = await this.rest("GET", `/search/issues?q=${query}&per_page=5`);
    const items = Array.isArray(json.items) ? json.items as Json[] : [];
    const exact = items.find((item) =>
      !item.pull_request && Number(item.number) > 0 &&
      typeof item.body === "string" && item.body.includes(marker)
    );
    return exact ? Number(exact.number) : null;
  }

  async createIssue(review: PublicProductReview): Promise<number> {
    const existing = await this.findIssueForSignal(review.signal_id);
    if (existing) return existing;
    const json = await this.rest(
      "POST",
      `/repos/${AVENGERS_REPOSITORY}/issues`,
      {
        title: review.public_title.trim(),
        body: buildIssueBody(review),
      },
    );
    const number = Number(json.number);
    if (!Number.isInteger(number) || number < 1) {
      throw stableError("GITHUB_CREATE_INVALID");
    }
    return number;
  }

  private async issueNode(issueNumber: number): Promise<Json> {
    const data = await this.graphql(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id number title url state updatedAt
            projectItems(first: 20) {
              nodes {
                id
                project { id number }
                fieldValues(first: 50) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { id name } }
                    }
                    ... on ProjectV2ItemFieldIterationValue {
                      title
                      field { ... on ProjectV2FieldCommon { id name } }
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      number
                      field { ... on ProjectV2FieldCommon { id name } }
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field { ... on ProjectV2FieldCommon { id name } }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field { ... on ProjectV2FieldCommon { id name } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
      { owner: AVENGERS_OWNER, repo: AVENGERS_REPO, number: issueNumber },
    );
    const repository = data.repository as Json | undefined;
    const issue = repository?.issue as Json | undefined;
    if (!issue?.id) throw stableError("GITHUB_ISSUE_NOT_FOUND");
    return issue;
  }

  async ensureProjectItem(
    issueNumber: number,
  ): Promise<{ issue: Json; itemId: string }> {
    let issue = await this.issueNode(issueNumber);
    const projectItems = issue.projectItems as Json | undefined;
    const nodes = Array.isArray(projectItems?.nodes)
      ? projectItems.nodes as Json[]
      : [];
    let item = nodes.find((node) =>
      (node.project as Json | undefined)?.id === AVENGERS_PROJECT_ID
    );
    if (!item) {
      const data = await this.graphql(
        `
        mutation($project: ID!, $content: ID!) {
          addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
            item { id }
          }
        }
      `,
        { project: AVENGERS_PROJECT_ID, content: issue.id },
      );
      const added = data.addProjectV2ItemById as Json | undefined;
      item = added?.item as Json | undefined;
      if (!item?.id) throw stableError("GITHUB_PROJECT_ADD_FAILED");
      issue = await this.issueNode(issueNumber);
    }
    return { issue, itemId: String(item.id) };
  }

  private async boardFields(): Promise<
    Map<string, { id: string; options: Map<string, string> }>
  > {
    const data = await this.graphql(
      `
      query($project: ID!) {
        node(id: $project) {
          ... on ProjectV2 {
            fields(first: 60) {
              nodes {
                ... on ProjectV2Field { id name }
                ... on ProjectV2SingleSelectField { id name options { id name } }
                ... on ProjectV2IterationField { id name }
              }
            }
          }
        }
      }
    `,
      { project: AVENGERS_PROJECT_ID },
    );
    const project = data.node as Json | undefined;
    const fields = project?.fields as Json | undefined;
    const nodes = Array.isArray(fields?.nodes) ? fields.nodes as Json[] : [];
    const mapped = new Map<
      string,
      { id: string; options: Map<string, string> }
    >();
    for (const node of nodes) {
      if (typeof node.name !== "string" || typeof node.id !== "string") {
        continue;
      }
      const options = new Map<string, string>();
      if (Array.isArray(node.options)) {
        for (const option of node.options as Json[]) {
          if (
            typeof option.name === "string" && typeof option.id === "string"
          ) options.set(option.name, option.id);
        }
      }
      mapped.set(node.name, { id: node.id, options });
    }
    return mapped;
  }

  private async setSingleSelect(
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    await this.graphql(
      `
      mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project, itemId: $item, fieldId: $field,
          value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }
    `,
      {
        project: AVENGERS_PROJECT_ID,
        item: itemId,
        field: fieldId,
        option: optionId,
      },
    );
  }

  async applyReviewedFields(
    itemId: string,
    review: PublicProductReview,
    includeStatus: boolean,
  ): Promise<void> {
    const fields = await this.boardFields();
    const desired: Array<[string, string]> = [
      ["Work Type", review.board_work_type],
      ["Product", review.board_product],
      ["Theme", review.board_theme],
      ["Priority", review.board_priority],
      ["Estimate", review.board_estimate],
      ["Horizon", review.board_horizon],
      ["Quarter", review.board_quarter],
      ["Refined", "No"],
    ];
    if (includeStatus) desired.push(["Status", "Todo"]);
    for (const [fieldNameValue, optionName] of desired) {
      const field = fields.get(fieldNameValue);
      const optionId = field?.options.get(optionName);
      if (!field || !optionId) throw stableError("GITHUB_BOARD_OPTION_MISSING");
      await this.setSingleSelect(itemId, field.id, optionId);
    }
  }

  async snapshot(issueNumber: number): Promise<AvengersSnapshot> {
    const { issue } = await this.ensureProjectItem(issueNumber);
    const projectItems = issue.projectItems as Json | undefined;
    const nodes = Array.isArray(projectItems?.nodes)
      ? projectItems.nodes as Json[]
      : [];
    const item = nodes.find((node) =>
      (node.project as Json | undefined)?.id === AVENGERS_PROJECT_ID
    );
    if (!item?.id) throw stableError("GITHUB_PROJECT_ITEM_MISSING");
    const values = new Map<string, string>();
    const fieldValues = item.fieldValues as Json | undefined;
    for (
      const node
        of (Array.isArray(fieldValues?.nodes)
          ? fieldValues.nodes as Json[]
          : [])
    ) {
      const name = fieldName(node);
      if (name) values.set(name, fieldText(node));
    }
    return {
      repository: AVENGERS_REPOSITORY,
      issue_number: Number(issue.number),
      issue_node_id: String(issue.id),
      project_item_id: String(item.id),
      issue_url: String(issue.url),
      issue_title: String(issue.title),
      issue_state: String(issue.state) === "CLOSED" ? "CLOSED" : "OPEN",
      issue_updated_at: String(issue.updatedAt),
      board_status: values.get("Status") ?? "",
      board_work_type: values.get("Work Type") ?? "",
      board_product: values.get("Product") ?? "",
      board_theme: values.get("Theme") ?? "",
      board_priority: values.get("Priority") ?? "",
      board_estimate: values.get("Estimate") ?? "",
      board_horizon: values.get("Horizon") ?? "",
      board_quarter: values.get("Quarter") ?? "",
      board_refined: values.get("Refined") ?? "",
      board_sprint: values.get("Sprint") ?? "",
    };
  }
}
