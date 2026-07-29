package com.crux.client.mixin;

import com.crux.client.CruxClient;
import com.crux.client.feature.Feature;
import net.minecraft.client.Camera;
import net.minecraft.client.renderer.GameRenderer;
import com.mojang.blaze3d.vertex.PoseStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(GameRenderer.class)
public class NoHurtcamMixin {

    @Inject(method = "bobHurt", at = @At("HEAD"), cancellable = true)
    private void onBobHurt(PoseStack poseStack, float tickDelta, CallbackInfo ci) {
        Feature f = CruxClient.getFeatureManager().getByName("Kein Hurtcam");
        if (f != null && f.isEnabled()) {
            ci.cancel();
        }
    }
}
