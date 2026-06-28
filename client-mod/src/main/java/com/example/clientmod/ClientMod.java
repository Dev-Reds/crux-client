package com.example.clientmod;

import com.example.clientmod.config.ModConfig;
import com.example.clientmod.hud.HudRenderer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;
import net.minecraft.client.MinecraftClient;

public class ClientMod implements ClientModInitializer {
    private static KeyBinding OPEN_MENU_KEY;

    @Override
    public void onInitializeClient() {
        // load config
        ModConfig.load();

        OPEN_MENU_KEY = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "key.clientmod.open_menu",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_RIGHT_SHIFT,
            "category.clientmod.keys"
        ));

        // HUD renderer
        HudRenderer.init();

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (OPEN_MENU_KEY.wasPressed()) {
                MinecraftClient.getInstance().execute(() -> {
                    MinecraftClient.getInstance().setScreen(new ClientMenuScreen());
                });
            }
        });
    }
}
