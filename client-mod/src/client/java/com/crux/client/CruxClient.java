package com.crux.client;

import com.crux.client.config.CruxConfig;
import com.crux.client.feature.Feature;
import com.crux.client.feature.FeatureManager;
import com.crux.client.gui.CruxMenuScreen;
import com.crux.client.hud.HudRenderer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class CruxClient implements ClientModInitializer {

    public static final String MOD_ID = "cruxclient";
    public static final String MOD_NAME = "Crux Client";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_NAME);

    private static CruxConfig config;
    private static FeatureManager featureManager;
    private static KeyMapping openSettingsKey;
    private static KeyMapping zoomKey;

    @Override
    public void onInitializeClient() {
        LOGGER.info("Initializing {} v{}", MOD_NAME, "1.0.0");

        config = CruxConfig.load();
        featureManager = new FeatureManager(config);

        openSettingsKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
                "key.cruxclient.open_settings",
                GLFW.GLFW_KEY_RIGHT_SHIFT,
                "category.cruxclient.main"
        ));

        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
                "key.cruxclient.zoom",
                GLFW.GLFW_KEY_C,
                "category.cruxclient.main"
        ));

        for (Feature f : featureManager.getAll()) {
            if (f.getKeyBind() != -1 && !f.isSettingsOnly()) {
                KeyMapping km = KeyBindingHelper.registerKeyBinding(new KeyMapping(
                        "key.cruxclient." + f.getName().toLowerCase().replace(" ", "_"),
                        f.getKeyBind(),
                        "category.cruxclient.features"
                ));
                f.setMappedKeyBinding(km);
            }
        }

        HudRenderCallback.EVENT.register((guiGraphics, tickCounter) -> {
            Minecraft mc = Minecraft.getInstance();
            if (mc.player == null || mc.level == null) return;
            if (mc.options.hideGui) return;
            HudRenderer.render(guiGraphics, featureManager);
        });

        ClientTickEvents.END_CLIENT_TICK.register(this::onClientTick);

        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            featureManager.onAttack();
            return net.minecraft.world.InteractionResult.PASS;
        });

        LOGGER.info("{} initialized! {} features loaded.", MOD_NAME, featureManager.getAll().size());
    }

    private void onClientTick(Minecraft client) {
        if (client.player == null || client.level == null) return;

        while (openSettingsKey.consumeClick()) {
            client.setScreen(new CruxMenuScreen(client));
        }

        while (client.options.keyAttack.consumeClick()) {
            featureManager.onLeftClick();
        }

        for (Feature f : featureManager.getAll()) {
            KeyMapping km = f.getMappedKeyBinding();
            if (km != null && km.consumeClick()) {
                f.toggle();
                CruxClient.syncAndSave();
            }
        }

        featureManager.tick();
    }

    public static CruxConfig getConfig() { return config; }
    public static FeatureManager getFeatureManager() { return featureManager; }

    public static void syncAndSave() {
        if (featureManager != null) featureManager.syncToConfig();
        if (config != null) config.save();
    }
}
