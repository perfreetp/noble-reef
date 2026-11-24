/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';
import './styles/global.css';
import './styles/panels.css';
import { projectStore } from './store/projectStore';
import { initTerrainService } from './engine/terrain/terrainService';

// 在渲染前初始化地形服务，保证 store 与引擎共用同一高度场实例
initTerrainService(
  projectStore.terrain.heights,
  projectStore.terrain.size,
  projectStore.terrain.cellSize,
);

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');
render(() => <App />, root);
