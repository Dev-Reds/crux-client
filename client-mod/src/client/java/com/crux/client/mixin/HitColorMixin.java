package com.crux.client.mixin;

import com.crux.client.CruxClient;
import com.crux.client.feature.Feature;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LivingEntityRenderer.class)
public class HitColorMixin {

    @Inject(method = "getOverlayCoords", at = @At("HEAD"), cancellable = true)
    private static void onGetOverlayCoords(LivingEntityRenderState state, float tickDelta, CallbackInfoReturnable<Integer> cir) {
        Feature f = CruxClient.getFeatureManager().getByName("Hit Color");
        if (f != null && f.isEnabled()) {
            cir.setReturnValue(61695); // Full white overlay
        }
    }
}
