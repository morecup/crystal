import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 4690,
        strictPort: true,
        // 关闭 Vite 的错误遮罩层，避免把运行时错误附着在页面上
        hmr: {
            overlay: false,
        },
    },
    base: './',
    build: {
        // Ensure assets are copied and paths are relative
        assetsDir: 'assets',
        // Copy public files to dist
        copyPublicDir: true
    }
});
