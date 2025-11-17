use anchor_lang::prelude::*;

pub mod constants;
pub mod state;
pub mod instructions;

pub use constants::*;
pub use state::*;
pub use instructions::*;

declare_id!("9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc");

#[program]
pub mod coffee_exchange {
    use super::*;

    pub fn make_offer(
        mut _ctx: Context<MakeOffer>, 
        id: u64, 
        token_a_offered_amount: u64,
        token_b_wanted_amount: u64) -> Result<()> {
        instructions::make_offer::send_offered_tokens_to_vault(&_ctx,token_a_offered_amount)?;
        instructions::make_offer::save_offer(&mut _ctx, id, token_b_wanted_amount)?;
        Ok(())
    }

    pub fn take_offer(ctx: Context<TakeOffer>) -> Result<()> {
        instructions::take_offer::send_wanted_tokens_to_maker(&ctx)?;
        instructions::take_offer::withdraw_and_close_vault(&ctx)?;
        Ok(())
    }
}


