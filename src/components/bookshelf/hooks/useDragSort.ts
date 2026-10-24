import { useCallback, Dispatch, SetStateAction, MutableRefObject } from "react";
import { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { IGroup, BookshelfTab } from "../../../types";
import { groupService, logError } from "../../../services";
import { useDndSensors, useDragGuard, useTabSwipe, isTouchDevice } from "../../../utils/gesture";
import { useAppNav } from "../../../router/useAppNav";

/**
 * 管理拖拽排序的 Hook
 * 负责书籍和分组的拖拽排序、顺序持久化、手势处理
 */
export const useDragSort = (params: {
    activeTab: BookshelfTab;
    groups: IGroup[];
    setGroups: Dispatch<SetStateAction<IGroup[]>>;
    selectionMode: boolean;
    groupOverlayOpen: boolean;
    importOpen: boolean;
    /** NAS 连接页签的连接 id 列表（滑动切换页签时用于构建动态序列） */
    nasTabIds?: string[];
    lastGroupCloseTimeRef: MutableRefObject<number>;
}) => {
    const {
        activeTab,
        groups,
        setGroups,
        selectionMode,
        groupOverlayOpen,
        importOpen,
        nasTabIds = [],
        lastGroupCloseTimeRef,
    } = params;

    const nav = useAppNav();

    const { dragActive, onDragStart, onDragEnd: onDragEndGuard, onDragCancel } = useDragGuard();

    // 动态页签序列：最近 → 本地(all) → 各 NAS 连接页签（nas:<id>）
    const tabSequence: BookshelfTab[] = ["recent", "all", ...nasTabIds.map((id): BookshelfTab => `nas:${id}`)];
    const { onTouchStart: swipeTouchStart, onTouchEnd: swipeTouchEnd } = useTabSwipe({
        // 左滑切到右侧下一个页签
        onLeft: () => {
            const idx = tabSequence.indexOf(activeTab);
            const next = idx >= 0 ? tabSequence[idx + 1] : undefined;
            if (next) {
                nav.toBookshelf(next, { replace: true });
            }
        },
        // 右滑切到左侧上一个页签
        onRight: () => {
            const idx = tabSequence.indexOf(activeTab);
            const prev = idx > 0 ? tabSequence[idx - 1] : undefined;
            if (prev) {
                nav.toBookshelf(prev, { replace: true });
            }
        },
        isBlocked: () => dragActive || selectionMode || groupOverlayOpen || importOpen,
        getCooldownTs: () => lastGroupCloseTimeRef.current,
    });

    const sensors = useDndSensors(isTouchDevice());

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        if (activeTab === "all") {
            const oldIndex = groups.findIndex((g) => g.id === active.id);
            const newIndex = groups.findIndex((g) => g.id === over.id);
            const newItems = arrayMove(groups, oldIndex, newIndex);

            // 立即更新UI
            setGroups(newItems);

            // 调用后端API持久化排序
            try {
                await groupService.reorderGroups(newItems.map((g) => g.id));
            } catch (e) {
                await logError('重排序分组失败', { error: String(e) });
            }
        }
    }, [activeTab, groups, setGroups]);

    return {
        dragActive,
        sensors,
        onDragStart,
        onDragEnd: (e: DragEndEvent) => {
            onDragEndGuard();
            handleDragEnd(e);
        },
        onDragCancel,
        swipeTouchStart,
        swipeTouchEnd,
    };
};
