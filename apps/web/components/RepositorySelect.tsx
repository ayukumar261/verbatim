"use client"

import { PencilIcon } from "lucide-react"
import { useState } from "react"

import { RepositoryPicker } from "@/components/RepositoryPicker"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useRepositories } from "@/hooks/use-repositories"
import type { Repository } from "@/hooks/use-repositories"
import { cn } from "@/lib/utils"

/** What the field shows and what each row reads. */
const toLabel = (repository: Repository) =>
  `${repository.owner}/${repository.name}`

interface RepositorySelectProps {
  value: Repository | null
  onValueChange: (repository: Repository | null) => void
  className?: string
}

/**
 * Picks the repository in scope. Nothing here is destructive, so connecting
 * and disconnecting both live behind the dialog instead.
 */
function RepositorySelect({
  value,
  onValueChange,
  className,
}: RepositorySelectProps) {
  const { repositories } = useRepositories()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Combobox
        items={repositories}
        value={value}
        onValueChange={onValueChange}
        itemToStringLabel={toLabel}
        isItemEqualToValue={(a, b) => a._id === b._id}
        // No search box here, so nothing owns a query. Without this the
        // combobox filters against an input value it fills in on selection.
        filter={null}
        open={open}
        onOpenChange={setOpen}
      >
        <ComboboxTrigger
          render={
            <Button variant="outline" className="w-full justify-between" />
          }
        >
          <span className="truncate">
            {value === null ? "Select a repository" : toLabel(value)}
          </span>
        </ComboboxTrigger>

        {/* The default min-width runs the popup wider than the field it hangs
            off. Pinning it to the anchor keeps the two edges flush. */}
        <ComboboxContent className="min-w-(--anchor-width)">
          <ComboboxList>
            {/* Only reachable if the last one is disconnected while this is
                open, since the page swaps to the picker at zero. */}
            <ComboboxEmpty>No repositories.</ComboboxEmpty>

            <ComboboxCollection>
              {(repository: Repository) => (
                <ComboboxItem key={repository._id} value={repository}>
                  <span className="flex-1 truncate">{toLabel(repository)}</span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>

          {/* Outside the list so it stays pinned however long the list gets.
              `p-1` matches the list's own padding, which is what lines this up
              with the rows above it. */}
          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 rounded-sm pl-2"
              onClick={() => {
                setOpen(false)
                setEditing(true)
              }}
            >
              <PencilIcon />
              Edit repositories
            </Button>
          </div>
        </ComboboxContent>
      </Combobox>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="flex max-h-[85svh] flex-col">
          <DialogHeader>
            <DialogTitle>Edit repositories</DialogTitle>
            <DialogDescription>
              Connect or disconnect repositories. Public only, for now.
            </DialogDescription>
          </DialogHeader>

          <RepositoryPicker />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { RepositorySelect }
