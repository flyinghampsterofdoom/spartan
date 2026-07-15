export type PermissionScope = "organization" | "self" | "assigned_project" | "assigned_crew";

export type PermissionGrant = {
  allowed: boolean;
  scope: PermissionScope;
};

export type AuthContext = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  membershipStatus: string;
  roleName: string;
  employeeId: string | null;
  permissions: Record<string, PermissionGrant>;
  platformRoles: string[];
};

export type ResourceScope = {
  organizationId: string;
  employeeId?: string | null;
  projectId?: string | null;
  crewId?: string | null;
  projectAssigned?: boolean;
  crewAssigned?: boolean;
};
