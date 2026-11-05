import type { ClientType, Project, Task } from "@prisma/client";
import { config } from "./config";

/** "EUR - Eurofins" → "Eurofins"; "KM - Kinetic Motorcycles" → "Kinetic Motorcycles" */
export function cleanProjectName(name: string): string {
  const m = name.match(/^[A-Z0-9]{1,6}\s*[-–:|]\s*(.+)$/);
  return (m ? m[1] : name).trim();
}

/** Which client a task belongs to. A task tag "client:Name" wins, then the Settings override, then Zoho's project field. */
export function clientOf(task: Pick<Task, "clientFromTag">, project: Project): { name: string; type: ClientType } {
  const name =
    task.clientFromTag?.trim() || project.clientOverride?.trim() || project.zohoClientName?.trim() || cleanProjectName(project.name);
  let type: ClientType =
    project.clientTypeOverride ?? project.zohoClientType ?? (config.internalNames.includes(name.toLowerCase()) ? "INTERNAL" : "CLIENT");
  // A client tag on an internal project means the work is really for a client
  if (task.clientFromTag && !config.internalNames.includes(task.clientFromTag.toLowerCase())) type = "CLIENT";
  return { name, type };
}
