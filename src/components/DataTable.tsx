import { ReactNode, useEffect, useMemo, useState, useCallback } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronLeft, ChevronRight, Columns3, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ColumnDef<T> {
  key: string;
  label: string;
  /** Always shown (cannot be hidden, e.g. checkbox / actions) */
  pinned?: "left" | "right";
  /** Shown by default when no saved prefs */
  defaultVisible?: boolean;
  /** Render cell content */
  render: (row: T) => ReactNode;
  /** Render header content (default: label) */
  headerRender?: () => ReactNode;
  className?: string;
  headClassName?: string;
  /** Excluded from the column-visibility picker */
  hideFromPicker?: boolean;
  /** Group label in the picker */
  group?: string;
}

const MAX_VISIBLE = 30;
const PAGE_SIZES = [25, 50, 65, 100, 200];

interface Props<T> {
  rows: T[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  /** Persist column visibility & order under this key */
  storageKey: string;
  rowClassName?: (row: T) => string;
  emptyMessage?: string;
  /** Right-side toolbar content (refresh button, etc.) */
  toolbar?: ReactNode;
}

interface Prefs {
  visible: string[];
  order: string[];
  pageSize: number;
}

function loadPrefs(key: string, defaults: Prefs): Prefs {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function savePrefs(key: string, p: Partial<Prefs>) {
  try {
    const existing = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...existing, ...p }));
  } catch { /* ignore */ }
}

export function DataTable<T>({
  rows,
  total,
  loading,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  columns,
  rowKey,
  storageKey,
  rowClassName,
  emptyMessage = "No data",
  toolbar,
}: Props<T>) {
  // Pinned columns are always visible & always at their pinned positions.
  const pinnedLeft = useMemo(() => columns.filter((c) => c.pinned === "left"), [columns]);
  const pinnedRight = useMemo(() => columns.filter((c) => c.pinned === "right"), [columns]);
  const movable = useMemo(() => columns.filter((c) => !c.pinned), [columns]);

  const defaults: Prefs = useMemo(
    () => ({
      visible: movable.filter((c) => c.defaultVisible !== false).map((c) => c.key),
      order: movable.map((c) => c.key),
      pageSize,
    }),
    [movable, pageSize],
  );

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(storageKey, defaults));

  // Reconcile: include any newly-discovered movable columns (e.g. extra raw_data keys),
  // and drop any orderings/visibles for keys that no longer exist.
  useEffect(() => {
    const movableKeys = new Set(movable.map((c) => c.key));
    const existingOrder = prefs.order.filter((k) => movableKeys.has(k));
    const newKeys = movable.map((c) => c.key).filter((k) => !existingOrder.includes(k));
    const order = [...existingOrder, ...newKeys];
    const visible = prefs.visible.filter((k) => movableKeys.has(k));
    if (order.length !== prefs.order.length || visible.length !== prefs.visible.length) {
      const next = { ...prefs, order, visible };
      setPrefs(next);
      savePrefs(storageKey, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movable]);

  const orderedMovable = useMemo(() => {
    const byKey = new Map(movable.map((c) => [c.key, c]));
    return prefs.order.map((k) => byKey.get(k)).filter(Boolean) as ColumnDef<T>[];
  }, [movable, prefs.order]);

  const visibleMovable = useMemo(
    () => orderedMovable.filter((c) => prefs.visible.includes(c.key)),
    [orderedMovable, prefs.visible],
  );

  const allHeaderColumns: ColumnDef<T>[] = useMemo(
    () => [...pinnedLeft, ...visibleMovable, ...pinnedRight],
    [pinnedLeft, visibleMovable, pinnedRight],
  );

  const toggleVisible = useCallback(
    (key: string) => {
      setPrefs((prev) => {
        const isOn = prev.visible.includes(key);
        if (!isOn && prev.visible.length >= MAX_VISIBLE) {
          toast.error(`Max ${MAX_VISIBLE} columns visible at once`);
          return prev;
        }
        const next = {
          ...prev,
          visible: isOn ? prev.visible.filter((k) => k !== key) : [...prev.visible, key],
        };
        savePrefs(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPrefs((prev) => {
      const oldIndex = prev.order.indexOf(active.id as string);
      const newIndex = prev.order.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = { ...prev, order: arrayMove(prev.order, oldIndex, newIndex) };
      savePrefs(storageKey, next);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min(total, (page + 1) * pageSize);

  // Group columns in picker
  const grouped = useMemo(() => {
    const groups = new Map<string, ColumnDef<T>[]>();
    movable.filter((c) => !c.hideFromPicker).forEach((c) => {
      const g = c.group ?? "Columns";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(c);
    });
    return Array.from(groups.entries());
  }, [movable]);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-md border border-border bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <span className="text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()} {total === 1 ? "row" : "rows"} · {prefs.visible.length + pinnedLeft.length + pinnedRight.length}/{movable.length + pinnedLeft.length + pinnedRight.length} cols
        </span>
        <div className="flex-1" />
        {toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="w-4 h-4 mr-2" /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] overflow-auto w-72 bg-popover">
            <DropdownMenuLabel className="text-xs">
              {prefs.visible.length} of max {MAX_VISIBLE} shown · drag headers to reorder
            </DropdownMenuLabel>
            {grouped.map(([group, cols], gi) => (
              <div key={group}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{group}</DropdownMenuLabel>
                {cols.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={prefs.visible.includes(c.key)}
                    onCheckedChange={() => toggleVisible(c.key)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
              <TableRow>
                {pinnedLeft.map((c) => (
                  <TableHead key={c.key} className={cn("whitespace-nowrap", c.headClassName)}>
                    {c.headerRender ? c.headerRender() : c.label}
                  </TableHead>
                ))}
                <SortableContext items={visibleMovable.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
                  {visibleMovable.map((c) => (
                    <SortableHeader key={c.key} col={c} />
                  ))}
                </SortableContext>
                {pinnedRight.map((c) => (
                  <TableHead key={c.key} className={cn("whitespace-nowrap", c.headClassName)}>
                    {c.headerRender ? c.headerRender() : c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={allHeaderColumns.length} className="h-32 text-center text-muted-foreground text-sm">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={allHeaderColumns.length} className="h-32 text-center text-muted-foreground text-sm">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow
                    key={rowKey(row)}
                    className={cn(
                      "even:bg-muted/20 hover:bg-accent/40 transition-colors",
                      rowClassName?.(row),
                    )}
                  >
                    {allHeaderColumns.map((c) => (
                      <TableCell key={c.key} className={cn("align-top", c.className)}>
                        {c.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-border bg-muted/30 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {showingFrom}–{showingTo} of {total.toLocaleString()}
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-muted-foreground">
          Rows
          <select
            value={pageSize}
            onChange={(e) => {
              const s = Number(e.target.value);
              onPageSizeChange(s);
              savePrefs(storageKey, { pageSize: s });
            }}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="tabular-nums">
          Page <input
            type="number"
            min={1}
            max={totalPages}
            value={page + 1}
            onChange={(e) => {
              const n = Math.max(1, Math.min(totalPages, Number(e.target.value) || 1));
              onPageChange(n - 1);
            }}
            className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-center"
          /> / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SortableHeader<T>({ col }: { col: ColumnDef<T> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <TableHead ref={setNodeRef} style={style} className={cn("whitespace-nowrap select-none", col.headClassName)}>
      <div className="flex items-center gap-1">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
          aria-label={`Drag ${col.label}`}
        >
          <GripVertical className="w-3 h-3" />
        </button>
        {col.headerRender ? col.headerRender() : col.label}
      </div>
    </TableHead>
  );
}
