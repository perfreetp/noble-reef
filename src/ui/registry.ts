import { AssetPanelElement } from './AssetPanel';
import { LayerPanelElement } from './LayerPanel';
import { PropertyPanelElement } from './PropertyPanel';
import { ExportBarElement } from './ExportBar';
import { CanvasViewElement } from './CanvasView';
import { StudioShellElement } from './StudioShell';

/**
 * 注册全部自定义元素。
 * 组件构造器参数可选(DI),浏览器对占位标签的无参升级不会抛错;
 * 业务里一律用 new X(deps) 显式构造并替换占位 div。
 */
export function defineElements(): void {
  const defs: [string, CustomElementConstructor][] = [
    [AssetPanelElement.tag, AssetPanelElement],
    [LayerPanelElement.tag, LayerPanelElement],
    [PropertyPanelElement.tag, PropertyPanelElement],
    [ExportBarElement.tag, ExportBarElement],
    [CanvasViewElement.tag, CanvasViewElement],
    [StudioShellElement.tag, StudioShellElement],
  ];
  for (const [tag, ctor] of defs) {
    if (!customElements.get(tag)) customElements.define(tag, ctor);
  }
}
