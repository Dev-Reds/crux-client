package com.crux.client.mixin;

import com.crux.client.CruxClient;
import com.crux.client.feature.Feature;
import com.crux.client.gui.CruxMenuScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Screen.class)
public class ClearBackgroundMixin {

    @Inject(method = "renderBackground", at = @At("HEAD"), cancellable = true)
    private void onRenderBackground(GuiGraphics guiGraphics, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        Screen self = (Screen) (Object) this;
        boolean isCruxScreen = self.getClass().getPackageName().contains("com.crux.client.gui");

        if (isCruxScreen) {
            ci.cancel();
            return;
        }

        Feature f = CruxClient.getFeatureManager().getByName("Klarer Hintergrund");
        if (f != null && f.isEnabled()) {
            int w = guiGraphics.guiWidth();
            int h = guiGraphics.guiHeight();
            guiGraphics.fill(0, 0, w, h, 0xA0000000);
            ci.cancel();
        }
    }
}
