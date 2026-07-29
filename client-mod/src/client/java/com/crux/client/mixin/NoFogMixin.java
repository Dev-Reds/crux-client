package com.crux.client.mixin;

import com.crux.client.CruxClient;
import com.crux.client.feature.Feature;
import com.mojang.blaze3d.shaders.FogShape;
import net.minecraft.client.Camera;
import net.minecraft.client.renderer.FogRenderer;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.FogParameters;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(FogRenderer.class)
public class NoFogMixin {

    @Inject(method = "setupFog", at = @At("RETURN"), cancellable = true)
    private static void onSetupFog(Camera camera, FogRenderer.FogMode fogMode, org.joml.Vector4f fogColor, float tickDelta, boolean thickFog, float biomeFogFactor, CallbackInfoReturnable<FogParameters> cir) {
        Feature f = CruxClient.getFeatureManager().getByName("Kein Nebel");
        if (f != null && f.isEnabled()) {
            cir.setReturnValue(new FogParameters(-1.0F, Float.MAX_VALUE, FogShape.SPHERE, fogColor.x(), fogColor.y(), fogColor.z(), fogColor.w()));
        }
    }
}
