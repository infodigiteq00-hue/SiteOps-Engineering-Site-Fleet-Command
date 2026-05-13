import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { mapSite, mapMachinery, mapRequest, mapLedger, type CompanyRow } from "@/lib/db-mapper";
import type { Site, SiteStatus, MachineryStatus, MachineryCategory, RequestSourceType } from "@/domain/types";
import { categoryCodePrefix, toCodeChunk } from "@/domain/types";
import { useAuth } from "@/contexts/AuthContext";
import { peekCurrentUser, ROLE_LABELS } from "@/lib/session";

export const operationalKeys = {
  all: ["operational"] as const,
  sites: () => [...operationalKeys.all, "sites"] as const,
  machinery: () => [...operationalKeys.all, "machinery"] as const,
  requests: () => [...operationalKeys.all, "requests"] as const,
  ledger: () => [...operationalKeys.all, "ledger"] as const,
  companies: () => [...operationalKeys.all, "companies"] as const,
};

function queriesEnabled(enabled: boolean) {
  return Boolean(enabled);
}

async function fetchSites(): Promise<Site[]> {
  const { data, error } = await supabase.from("sites").select("*").order("name");
  if (error) throw error;
  return (data ?? []).map(mapSite);
}

async function fetchMachinery() {
  const { data, error } = await supabase.from("machinery").select("*").order("code");
  if (error) throw error;
  return (data ?? []).map(mapMachinery);
}

async function fetchRequests() {
  const { data, error } = await supabase.from("machinery_requests").select("*").order("requested_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRequest);
}

async function fetchLedger() {
  const { data, error } = await supabase.from("audit_ledger").select("*").order("approved_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapLedger);
}

async function fetchCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabase.from("companies").select("id, name").order("name");
  if (error) throw error;
  return (data ?? []) as CompanyRow[];
}

export function useSitesQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.sites(), queryFn: fetchSites, enabled: ok });
}

export function useMachineryQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.machinery(), queryFn: fetchMachinery, enabled: ok });
}

export function useRequestsQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.requests(), queryFn: fetchRequests, enabled: ok });
}

export function useLedgerQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({
    queryKey: operationalKeys.ledger(),
    queryFn: fetchLedger,
    enabled: ok,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompaniesQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.companies(), queryFn: fetchCompanies, enabled: ok });
}

/** Resolved company display names from Supabase (empty until loaded). */
export function useCompanyNameMap(): Record<string, string> {
  const { data } = useCompaniesQuery();
  return useMemo(() => Object.fromEntries((data ?? []).map((c) => [c.id, c.name])), [data]);
}

function invalidateOperational(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: operationalKeys.all });
}

export type AppendAuditLedgerInput = {
  companyId: string;
  eventKind: string;
  summary: string;
  siteId?: string | null;
  machineIds?: string[];
  requestId?: string | null;
  requester?: string;
  approvedBy?: string;
  approverRole?: string | null;
  fromDate?: string | null;
  untilDate?: string | null;
  totalUnits?: number;
  approvedAt?: string;
};

/** SECURITY DEFINER RPC (see migrations). Throws on denial / DB errors. Best-effort callers may catch+log. */
export async function appendAuditLedgerEntry(input: AppendAuditLedgerInput): Promise<void> {
  const { error } = await supabase.rpc("append_audit_ledger", {
    p_company_id: input.companyId,
    p_event_kind: input.eventKind,
    p_summary: input.summary,
    p_site_id: input.siteId ?? null,
    p_machine_ids: input.machineIds ?? [],
    p_request_id: input.requestId ?? null,
    p_requester: input.requester ?? "System",
    p_approved_by: input.approvedBy ?? "System",
    p_approver_role: input.approverRole ?? null,
    p_from_date: input.fromDate ?? null,
    p_until_date: input.untilDate ?? null,
    p_total_units: input.totalUnits ?? 0,
    p_approved_at: input.approvedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
}

/** Machinery.id is globally unique (not scoped per company); do not derive m1,m2… from tenant-filtered selects. */
function newMachineryRowId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "")}`;
}

export type CreateSiteInput = {
  name: string;
  location: string;
  machineIds: string[];
  companyId: string;
  /** When true, ledger uses site_created_bulk_upload for clearer audit trail. */
  createdDuringBulkUpload?: boolean;
};

export function useCreateSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSiteInput) => {
      const siteId = `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const startDate = new Date().toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let code = toCodeChunk(input.name);
      const { data: clash } = await supabase.from("sites").select("id").eq("company_id", input.companyId).eq("code", code).maybeSingle();
      if (clash?.id) code = `${toCodeChunk(input.name)}-${siteId.slice(-4)}`.slice(0, 24);

      const { error: insErr } = await supabase.from("sites").insert({
        id: siteId,
        company_id: input.companyId,
        name: input.name.trim(),
        code,
        location: input.location.trim(),
        manager: "Operations Lead",
        status: "active",
        start_date: startDate,
        end_date: endDate,
      });
      if (insErr) throw insErr;

      if (input.machineIds.length > 0) {
        const { error: upErr } = await supabase
          .from("machinery")
          .update({ status: "assigned", assigned_site_id: siteId })
          .in("id", input.machineIds);
        if (upErr) throw upErr;
      }

      const actor = peekCurrentUser();
      try {
        const bulk = Boolean(input.createdDuringBulkUpload);
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: bulk ? "site_created_bulk_upload" : "site_created",
          summary: bulk
            ? `New site "${input.name.trim()}" was created during bulk upload (${input.location.trim()}).`
            : `Site created: ${input.name.trim()} — ${input.location.trim()}`,
          siteId,
          machineIds: input.machineIds.length ? [...input.machineIds] : [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: input.machineIds.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_created", err);
      }

      return siteId;
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type UpdateSiteInput = {
  siteId: string;
  companyId: string;
  name?: string;
  manager?: string;
  status?: SiteStatus;
};

export function useUpdateSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSiteInput) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.manager !== undefined) patch.manager = input.manager.trim();
      if (input.status !== undefined) patch.status = input.status;
      const { error } = await supabase.from("sites").update(patch).eq("id", input.siteId);
      if (error) throw error;

      const actor = peekCurrentUser();
      const bits: string[] = [];
      if (input.name !== undefined) bits.push(`name → "${input.name.trim()}"`);
      if (input.manager !== undefined) bits.push(`managers → "${input.manager.trim()}"`);
      if (input.status !== undefined) bits.push(`status → ${input.status}`);
      try {
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: input.status === "completed" ? "site_marked_completed" : "site_updated",
          summary: `Site updated (${bits.join("; ")}).`,
          siteId: input.siteId,
          machineIds: [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_updated", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeleteSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { siteId: string; companyId: string; siteName: string }) => {
      const { error } = await supabase.from("sites").delete().eq("id", args.siteId);
      if (error) throw error;
      const actor = peekCurrentUser();
      try {
        await appendAuditLedgerEntry({
          companyId: args.companyId,
          eventKind: "site_deleted",
          summary: `Site deleted: "${args.siteName}" (${args.siteId}).`,
          siteId: null,
          machineIds: [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_deleted", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type CreateRequestInput = {
  siteId: string;
  machineIds: string[];
  sourceType: RequestSourceType;
  sourceSiteId?: string;
  requestedCategory?: MachineryCategory;
  requestedQuantity?: number;
  requester: string;
  reason: string;
  neededFrom: string;
  neededUntil: string;
};

export function useCreateRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: CreateRequestInput) => {
      const { data: site, error: siteErr } = await supabase.from("sites").select("company_id").eq("id", r.siteId).single();
      if (siteErr || !site?.company_id) throw new Error(siteErr?.message ?? "Site not found or missing company");
      const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from("machinery_requests").insert({
        id,
        company_id: site.company_id,
        site_id: r.siteId,
        machine_ids: r.machineIds,
        source_type: r.sourceType,
        source_site_id: r.sourceSiteId ?? null,
        requested_category: r.requestedCategory ?? null,
        requested_quantity: r.requestedQuantity ?? null,
        requester: r.requester,
        reason: r.reason,
        needed_from: r.neededFrom,
        needed_until: r.neededUntil,
      });
      if (error) throw error;

      const actor = peekCurrentUser();
      try {
        await appendAuditLedgerEntry({
          companyId: site.company_id,
          eventKind: "request_created",
          summary: `New ${r.sourceType.replace(/_/g, " ")} request (${r.machineIds.length} asset(s)): ${r.reason.trim().slice(0, 200)}`,
          siteId: r.siteId,
          requestId: id,
          requester: r.requester,
          approvedBy: actor?.name ?? r.requester,
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          machineIds: r.machineIds,
          fromDate: r.neededFrom,
          untilDate: r.neededUntil,
          totalUnits: r.machineIds.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after request_created", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type RequestDecision = { actorName: string; actorRole: string; notes?: string };

export async function approveRequestRemote(requestId: string, decision: RequestDecision) {
  const { data: reqRow, error: rErr } = await supabase.from("machinery_requests").select("*").eq("id", requestId).single();
  if (rErr || !reqRow) throw new Error(rErr?.message ?? "Request not found");
  const req = mapRequest(reqRow);

  const decidedAt = new Date().toISOString();
  const notes = decision.notes?.trim() || null;
  let allocatedMachineIds = [...req.machineIds];
  const requestCompanyId = req.companyId;

  if (req.sourceType === "purchase") {
    const category = req.requestedCategory;
    const quantity = req.requestedQuantity ?? 0;
    if (!category || quantity <= 0) throw new Error("Invalid purchase request");

    const { data: machRows, error: listErr } = await supabase.from("machinery").select("id, code").eq("company_id", requestCompanyId);
    if (listErr) throw listErr;
    const machines = (machRows ?? []).map((row) => mapMachinery(row));

    const highestCodeNumber = machines.reduce((maxCode, machine) => {
      const match = machine.code.match(/-(\d+)$/);
      const parsed = match ? Number.parseInt(match[1], 10) : -1;
      return Number.isFinite(parsed) ? Math.max(maxCode, parsed) : maxCode;
    }, -1);

    const newRows = Array.from({ length: quantity }).map((_, index) => {
      const codeNumber = highestCodeNumber + index + 1;
      const categoryPrefix = categoryCodePrefix[category] ?? toCodeChunk(category);
      return {
        id: newMachineryRowId(),
        company_id: requestCompanyId,
        code: `${categoryPrefix}-${String(codeNumber).padStart(3, "0")}`,
        name: `${category} Unit ${codeNumber}`,
        category,
        status: "assigned" as const,
        assigned_site_id: req.siteId,
      };
    });

    allocatedMachineIds = newRows.map((r) => r.id);
    const { error: insErr } = await supabase.from("machinery").insert(newRows);
    if (insErr) throw insErr;
  } else {
    const { error: upErr } = await supabase
      .from("machinery")
      .update({ status: "assigned", assigned_site_id: req.siteId })
      .in("id", allocatedMachineIds);
    if (upErr) throw upErr;
  }

  const { error: reqUp } = await supabase
    .from("machinery_requests")
    .update({
      status: "approved",
      decided_at: decidedAt,
      decided_by: decision.actorName,
      decider_role: decision.actorRole,
      decision_notes: notes,
    })
    .eq("id", requestId);
  if (reqUp) throw reqUp;

  const summaryText = [
    `${decision.actorName} (${decision.actorRole}) approved ${req.sourceType.replace(/_/g, " ")} request.`,
    `${allocatedMachineIds.length} asset(s).`,
    req.reason.trim() ? req.reason.trim().slice(0, 200) : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await appendAuditLedgerEntry({
      companyId: requestCompanyId,
      eventKind: "request_approved",
      summary: summaryText,
      siteId: req.siteId,
      machineIds: allocatedMachineIds,
      requestId: req.id,
      requester: req.requester,
      approvedBy: decision.actorName,
      approverRole: decision.actorRole,
      fromDate: req.neededFrom,
      untilDate: req.neededUntil,
      totalUnits: allocatedMachineIds.length,
      approvedAt: decidedAt,
    });
  } catch (err) {
    console.warn("[ledger] append skipped after request_approved (apply migration 20260510203000 if missing)", err);
  }
}

export async function rejectRequestRemote(requestId: string, decision: RequestDecision) {
  const { data: reqRow, error: rErr } = await supabase.from("machinery_requests").select("*").eq("id", requestId).single();
  if (rErr || !reqRow) throw new Error(rErr?.message ?? "Request not found");
  const req = mapRequest(reqRow);

  const decidedAt = new Date().toISOString();
  const notes = decision.notes?.trim() || null;
  const { error } = await supabase
    .from("machinery_requests")
    .update({
      status: "rejected",
      decided_at: decidedAt,
      decided_by: decision.actorName,
      decider_role: decision.actorRole,
      decision_notes: notes,
    })
    .eq("id", requestId);
  if (error) throw error;

  const summaryText = [
    `${decision.actorName} (${decision.actorRole}) rejected machinery request.`,
    req.reason.trim().slice(0, 200),
    notes ? `Notes: ${notes.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await appendAuditLedgerEntry({
      companyId: req.companyId,
      eventKind: "request_rejected",
      summary: summaryText,
      siteId: req.siteId,
      machineIds: req.machineIds,
      requestId: req.id,
      requester: req.requester,
      approvedBy: decision.actorName,
      approverRole: decision.actorRole,
      fromDate: req.neededFrom,
      untilDate: req.neededUntil,
      totalUnits: req.machineIds.length,
      approvedAt: decidedAt,
    });
  } catch (err) {
    console.warn("[ledger] append skipped after request_rejected", err);
  }
}

export function useApproveRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: RequestDecision }) => approveRequestRemote(id, decision),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useRejectRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: RequestDecision }) => rejectRequestRemote(id, decision),
    onSuccess: () => invalidateOperational(qc),
  });
}

export type MachineUpdate = Partial<{
  status: MachineryStatus;
  assignedSiteId: string | null;
  projectName: string | undefined;
  projectLocation: string | undefined;
  assignedTo: string | undefined;
  approvedBy: string | undefined;
}>;

export function useUpdateMachineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ machineId, updates }: { machineId: string; updates: MachineUpdate }) => {
      const { data: row, error: gErr } = await supabase.from("machinery").select("*").eq("id", machineId).maybeSingle();
      if (gErr) throw gErr;
      if (!row) throw new Error("Machinery not found");
      const before = mapMachinery(row);

      const patch: Record<string, unknown> = {};
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.assignedSiteId !== undefined) patch.assigned_site_id = updates.assignedSiteId;
      if (updates.projectName !== undefined) patch.project_name = updates.projectName ?? null;
      if (updates.projectLocation !== undefined) patch.project_location = updates.projectLocation ?? null;
      if (updates.assignedTo !== undefined) patch.assigned_to = updates.assignedTo ?? null;
      if (updates.approvedBy !== undefined) patch.approved_by = updates.approvedBy ?? null;

      const { error } = await supabase.from("machinery").update(patch).eq("id", machineId);
      if (error) throw error;

      const idsToLabel = [...new Set([before.assignedSiteId, updates.assignedSiteId].filter(Boolean))] as string[];
      let siteNamesById: Record<string, string> = {};
      if (idsToLabel.length > 0) {
        const { data: siteRows } = await supabase.from("sites").select("id,name").in("id", idsToLabel);
        siteNamesById = Object.fromEntries((siteRows ?? []).map((r) => [String(r.id), String(r.name)]));
      }
      const describeSite = (id: string | null) =>
        id == null ? "company pool" : siteNamesById[id] ?? id;

      const changes: string[] = [];
      let eventKind = "machinery_field_updated";

      if (updates.status !== undefined && updates.status !== before.status) {
        changes.push(`Status ${before.status} → ${updates.status}`);
      }
      if (updates.assignedSiteId !== undefined && updates.assignedSiteId !== before.assignedSiteId) {
        changes.push(`Transferred ${describeSite(before.assignedSiteId)} → ${describeSite(updates.assignedSiteId)}`);
      }
      if (updates.projectName !== undefined && updates.projectName?.trim() !== (before.projectName ?? "").trim()) {
        changes.push("Project title updated");
      }
      if (updates.projectLocation !== undefined && updates.projectLocation?.trim() !== (before.projectLocation ?? "").trim()) {
        changes.push("Site / location notes updated");
      }
      if (updates.assignedTo !== undefined && updates.assignedTo?.trim() !== (before.assignedTo ?? "").trim()) {
        changes.push("Assigned personnel updated");
      }
      if (updates.approvedBy !== undefined && updates.approvedBy?.trim() !== (before.approvedBy ?? "").trim()) {
        changes.push("Approval contact updated");
      }

      const siteChanged =
        updates.assignedSiteId !== undefined && updates.assignedSiteId !== before.assignedSiteId;
      if (siteChanged) eventKind = "machinery_relocated";
      else if (updates.status !== undefined && updates.status !== before.status) eventKind = "machinery_status_changed";

      if (changes.length > 0) {
        const actor = peekCurrentUser();
        const auditSite =
          updates.assignedSiteId !== undefined ? updates.assignedSiteId : before.assignedSiteId;
        try {
          await appendAuditLedgerEntry({
            companyId: before.companyId,
            eventKind,
            summary: `[${before.code}] ${before.name} — ${changes.join("; ")}`,
            siteId: auditSite,
            machineIds: [machineId],
            requester: actor?.name ?? "System",
            approvedBy: actor?.name ?? "System",
            approverRole: actor ? ROLE_LABELS[actor.role] : null,
            totalUnits: 1,
          });
        } catch (err) {
          console.warn("[ledger] append skipped after machinery update", err);
        }
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeleteMachineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (machineId: string) => {
      const { data: row, error: gErr } = await supabase.from("machinery").select("*").eq("id", machineId).maybeSingle();
      if (gErr) throw gErr;
      const before = row ? mapMachinery(row) : null;

      const { error } = await supabase.from("machinery").delete().eq("id", machineId);
      if (error) throw error;

      if (before) {
        const actor = peekCurrentUser();
        try {
          await appendAuditLedgerEntry({
            companyId: before.companyId,
            eventKind: "machinery_deleted",
            summary: `Removed machinery ${before.code} (${before.name}).`,
            siteId: before.assignedSiteId,
            machineIds: [machineId],
            requester: actor?.name ?? "System",
            approvedBy: actor?.name ?? "System",
            approverRole: actor ? ROLE_LABELS[actor.role] : null,
            totalUnits: 1,
          });
        } catch (err) {
          console.warn("[ledger] append skipped after machinery_deleted", err);
        }
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type AddMachineryUnit = {
  code: string;
  name: string;
  projectName?: string;
  projectLocation?: string;
  assignedTo?: string;
  approvedBy?: string;
};

export type AddMachineryPayload = {
  category: string;
  status: MachineryStatus;
  assignedSiteId: string | null;
  companyId: string;
  units: AddMachineryUnit[];
  /** When set (e.g. bulk CSV import), ledger summary mentions bulk upload. */
  ledgerImportTag?: "bulk_csv";
};

export function useAddMachineryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AddMachineryPayload) => {
      const normalizedUnits = payload.units
        .map((unit) => ({
          code: unit.code.trim(),
          name: unit.name.trim(),
          project_name: unit.projectName?.trim() ?? null,
          project_location: unit.projectLocation?.trim() ?? null,
          assigned_to: unit.assignedTo?.trim() ?? null,
          approved_by: unit.approvedBy?.trim() ?? null,
        }))
        .filter((unit) => unit.code && unit.name);
      if (!payload.category.trim() || normalizedUnits.length === 0) throw new Error("Invalid machinery payload");

      let siteCompany = payload.companyId;
      if (payload.assignedSiteId) {
        const { data: st } = await supabase.from("sites").select("company_id").eq("id", payload.assignedSiteId).single();
        siteCompany = st?.company_id ?? payload.companyId;
      }

      const fixedRows = normalizedUnits.map((unit) => {
        return {
          id: newMachineryRowId(),
          company_id: siteCompany,
          code: unit.code,
          name: unit.name,
          category: payload.category.trim(),
          status: payload.status,
          assigned_site_id: payload.status === "assigned" ? payload.assignedSiteId : null,
          project_name: unit.project_name,
          project_location: unit.project_location,
          assigned_to: unit.assigned_to,
          approved_by: unit.approved_by,
        };
      });

      const { error: insErr } = await supabase.from("machinery").insert(fixedRows);
      if (insErr) throw insErr;

      const actor = peekCurrentUser();
      const siteIdForLedger = payload.status === "assigned" ? payload.assignedSiteId : null;
      const codeNameList = normalizedUnits.map((unit) => `${unit.code} (${unit.name})`).join("; ");
      const bulkNote = payload.ledgerImportTag === "bulk_csv" ? "Bulk CSV import · " : "";
      const clipped = codeNameList.length > 400 ? `${codeNameList.slice(0, 400)}…` : codeNameList;
      try {
        await appendAuditLedgerEntry({
          companyId: siteCompany,
          eventKind: "machinery_created",
          summary: `${bulkNote}${actor?.name ?? "User"} added ${normalizedUnits.length} unit(s) — ${payload.category.trim()}: ${clipped}`,
          siteId: siteIdForLedger,
          machineIds: fixedRows.map((r) => r.id as string),
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: normalizedUnits.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after machinery_created", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}
