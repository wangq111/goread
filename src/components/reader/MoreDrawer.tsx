import React from "react";
import { useTranslation } from 'react-i18next';
import { BOTTOM_DRAWER_RADIUS } from "../../constants/ui";
import { getSafeAreaInsets } from "../../utils/layout";
import type { PageTurnEffect } from "../../types";

/** 翻页动画选项定义（T33）：value 与后端 page_turn_effect 枚举对齐；as const 保证 i18n 键字面量类型 */
const PAGE_TURN_EFFECT_OPTIONS = [
  { value: "slide", labelKey: "pageTurnEffectSlide" },
  { value: "cover", labelKey: "pageTurnEffectCover" },
  { value: "none", labelKey: "pageTurnEffectNone" },
] as const;

interface MoreDrawerProps {
  visible: boolean;
  onClose: () => void;
  onSettings: () => void;
  hideDivider: boolean;
  onToggleHideDivider: () => void;
  /** 当前阅读模式：翻页动画仅在横向分页模式生效，纵向滚动模式下置灰禁用 */
  readingMode: "horizontal" | "vertical";
  /** 当前生效的翻页动画效果（按书记忆） */
  pageTurnEffect: PageTurnEffect;
  /** 切换翻页动画效果回调（按书记忆持久化，即时生效） */
  onSetPageTurnEffect: (effect: PageTurnEffect) => void;
}

export const MoreDrawer: React.FC<MoreDrawerProps> = ({
  visible,
  onClose,
  onSettings,
  hideDivider,
  onToggleHideDivider,
  readingMode,
  pageTurnEffect,
  onSetPageTurnEffect,
}: MoreDrawerProps) => {
  const { t } = useTranslation('reader');

  if (!visible) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#1f1f1f",
          borderRadius: `${BOTTOM_DRAWER_RADIUS}px ${BOTTOM_DRAWER_RADIUS}px 0 0`,
          padding: "12px 0",
          paddingBottom: `calc(12px + ${getSafeAreaInsets().bottom})`,
          display: "flex",
          flexDirection: "column",
          animation: "slideUp 0.3s ease-out",
        }}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleHideDivider();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 24px",
            cursor: "pointer",
            color: "#fff",
            justifyContent: "space-between",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2a")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                fontSize: "20px",
                marginRight: "16px",
                width: "24px",
                textAlign: "center",
              }}
            >
              👁️
            </div>
            <span style={{ fontSize: "16px" }}>{t('hidePageDivider')}</span>
          </div>
          <div
            style={{
              width: "40px",
              height: "24px",
              backgroundColor: hideDivider ? "#e53935" : "#3e3e3e",
              borderRadius: "12px",
              position: "relative",
              transition: "background-color 0.2s",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: "#fff",
                borderRadius: "50%",
                position: "absolute",
                top: "2px",
                left: hideDivider ? "18px" : "2px",
                transition: "left 0.2s, background-color 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              }}
            />
          </div>
        </div>

        {/* 翻页动画选择区（T33）：仅横向分页模式生效，纵向滚动模式下整块置灰禁用 */}
        <div
          style={{
            padding: "16px 24px",
            opacity: readingMode === "horizontal" ? 1 : 0.4,
            pointerEvents: readingMode === "horizontal" ? "auto" : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: "12px" }}>
            <div
              style={{
                fontSize: "20px",
                marginRight: "16px",
                width: "24px",
                textAlign: "center",
              }}
            >
              📖
            </div>
            <span style={{ fontSize: "16px", color: "#fff" }}>{t('pageTurnEffect')}</span>
          </div>
          <div style={{ display: "flex", gap: "8px", padding: "0 40px" }}>
            {PAGE_TURN_EFFECT_OPTIONS.map((option) => {
              const selected = pageTurnEffect === option.value;
              return (
                <div
                  key={option.value}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetPageTurnEffect(option.value);
                  }}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    textAlign: "center",
                    fontSize: "14px",
                    borderRadius: "8px",
                    border: selected ? "1px solid #e53935" : "1px solid #3e3e3e",
                    backgroundColor: selected ? "rgba(229,57,53,0.15)" : "transparent",
                    color: selected ? "#e53935" : "#ccc",
                    cursor: "pointer",
                  }}
                >
                  {t(option.labelKey)}
                </div>
              );
            })}
          </div>
        </div>

        <div
          onClick={onSettings}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 24px",
            cursor: "pointer",
            color: "#fff",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2a")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <div
            style={{
              fontSize: "20px",
              marginRight: "16px",
              width: "24px",
              textAlign: "center",
            }}
          >
            ⚙️
          </div>
          <span style={{ fontSize: "16px" }}>{t('settings')}</span>
        </div>
      </div>
    </div>
  );
};
