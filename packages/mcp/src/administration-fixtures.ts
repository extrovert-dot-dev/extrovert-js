import type { AdministrativeRequest } from "./administration.js";

/** Explicit offline full-control fixture; ordinary mock agent keys stay scoped. */
export const ADMINISTRATIVE_FIXTURE_KEY = "ev_credential_mock_full_account";
export class AdministrativeFixtures {
  private projects = [{ id: "prj_demo", org_id: "org_demo", customer_id: "cus_demo", name: "Demo", slug: "demo", description: "", is_default: true, lifecycle_status: "active", version: 1, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" }];
  constructor(private readonly credential = "") {}

  async request(request: AdministrativeRequest): Promise<unknown> {
    if (this.credential !== ADMINISTRATIVE_FIXTURE_KEY) throw new Error("Full account control is required. For offline administration use ADMINISTRATIVE_FIXTURE_KEY.");
    const org = { id: "org_demo", name: "Demo organization", role: "owner" };
    if (request.method === "GET" && request.path === "/v1/admin/me") return { user_id: "user_demo", is_admin: false, orgs: [org], projects: this.projects };
    if (request.method === "GET" && request.path === "/v1/admin/orgs") return { orgs: [org] };
    if (request.path === "/v1/admin/orgs/org_demo/projects") {
      if (request.method === "GET") return { projects: this.projects.map((p) => ({ ...p })) };
      if (request.method === "POST") {
        const body = request.body as { name: string; slug?: string };
        const project = { ...this.projects[0]!, id: `prj_demo_${this.projects.length}`, name: body.name, slug: body.slug ?? body.name.toLowerCase().replace(/\s+/g, "-"), is_default: false };
        this.projects.push(project);
        return { ...project };
      }
    }
    throw new Error(`No offline administrative fixture for ${request.method} ${request.path}. Use a test HTTP server for this action; no action was performed.`);
  }
}
