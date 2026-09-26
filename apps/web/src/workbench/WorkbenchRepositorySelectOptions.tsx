import type { ProjectId } from "@t3tools/contracts";
import { SelectItem } from "../components/ui/select";
import type { Project } from "../types";

export function WorkbenchRepositorySelectOptions({
  projects,
  selectedProjectIds,
}: {
  projects: ReadonlyArray<Pick<Project, "id" | "title">>;
  selectedProjectIds: ReadonlyArray<ProjectId>;
}) {
  return (
    <>
      {projects
        .filter((project) => selectedProjectIds.includes(project.id))
        .map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.title}
          </SelectItem>
        ))}
    </>
  );
}
