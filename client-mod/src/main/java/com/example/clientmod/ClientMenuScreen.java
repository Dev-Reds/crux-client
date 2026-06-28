package com.example.clientmod;

import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import net.minecraft.client.MinecraftClient;

public class ClientMenuScreen extends Screen {
    protected ClientMenuScreen() {
        super(Text.of("Client Menu"));
    }

    @Override
    protected void init() {
        int midW = this.width / 2;
        int y = this.height / 4;

        this.addDrawableChild(new ButtonWidget(midW - 100, y, 200, 20, Text.of("Toggle FPS Display: " + (com.example.clientmod.config.ModConfig.showFps ? "ON" : "OFF")), btn -> {
            com.example.clientmod.config.ModConfig.showFps = !com.example.clientmod.config.ModConfig.showFps;
            com.example.clientmod.config.ModConfig.save();
            btn.setMessage(Text.of("Toggle FPS Display: " + (com.example.clientmod.config.ModConfig.showFps ? "ON" : "OFF")));
        }));

        this.addDrawableChild(new ButtonWidget(midW - 100, y + 24, 200, 20, Text.of("Toggle Coordinates: " + (com.example.clientmod.config.ModConfig.showCoords ? "ON" : "OFF")), btn -> {
            com.example.clientmod.config.ModConfig.showCoords = !com.example.clientmod.config.ModConfig.showCoords;
            com.example.clientmod.config.ModConfig.save();
            btn.setMessage(Text.of("Toggle Coordinates: " + (com.example.clientmod.config.ModConfig.showCoords ? "ON" : "OFF")));
        }));

        this.addDrawableChild(new ButtonWidget(midW - 100, y + 48, 200, 20, Text.of("Close"), btn -> {
            MinecraftClient.getInstance().setScreen(null);
        }));
    }

    @Override
    public boolean shouldPause() {
        return false;
    }
}
