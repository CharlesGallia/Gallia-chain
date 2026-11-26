// Copyright 2021 Axiom-Team
//
// This file is part of Duniter-v2S.
//
// Duniter-v2S is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License.
//
// Duniter-v2S is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with Duniter-v2S. If not, see <https://www.gnu.org/licenses/>.

//! # Duniter Web of Trust Pallet
//!
//! Duniter Web of Trust (WoT) lies at the heart of its identity system, representing a significant improvement over PGP Web of Trust. It functions as a dynamic directed graph where nodes are [identities](../identity/) and edges are [certifications](../certification/).
//!
//! ## Instances
//!
//! Duniter WoT consists of two distinct instances:
//!
//! - **Main WoT**: Designed for every human participant in the Duniter network.
//! - **Smith Sub-WoT**: Intended for authorities.
//!
//! ## Rules
//!
//! The Duniter WoT operates under a set of static and dynamic rules that govern membership conditions.
//!
//! ### Static Rules
//!
//! - **Minimum Received Certifications (Min Indegree)**: Specifies the minimum number of certifications an identity must receive to join the WoT.
//! - **Maximum Emitted Certifications (Max Outdegree)**: Limits the maximum number of certifications an identity can issue.
//! - **Distance Criterion**: Governed by the distance pallet, it defines the permissible distance between identities within the WoT graph.
//!
//! ### Dynamic Rules
//!
//! - **Time Interval Between Certifications**: Sets the minimum time interval required between two consecutive certifications issued by the same identity.
//! - **Certification Duration**: Managed by the certification pallet, it determines the validity duration of a certification.
//! - **Membership Renewal**: Regulates the frequency and conditions under which an identity must renew its membership within the WoT.
//!
//! This pallet is responsible for enforcing and validating the rules of the Duniter Web of Trust. It ensures compliance with both static prerequisites for joining and dynamic conditions for ongoing participation.

#![cfg_attr(not(feature = "std"), no_std)]
#![allow(clippy::type_complexity)]

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

pub use pallet::*;

use frame_support::pallet_prelude::*;
use pallet_certification::traits::SetNextIssuableOn;
use pallet_identity::IdtyStatus;
use pallet_membership::MembershipRemovalReason;

type IdtyIndex = u32;

#[allow(unreachable_patterns)]
#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::traits::StorageVersion;
    use frame_system::pallet_prelude::*;

    /// The current storage version.
    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    #[pallet::without_storage_info]
    pub struct Pallet<T>(_);

    // CONFIG //

    #[pallet::config]
    pub trait Config:
        frame_system::Config
        + pallet_certification::Config<IdtyIndex = IdtyIndex>
        + pallet_identity::Config<IdtyIndex = IdtyIndex>
        + pallet_membership::Config<IdtyId = IdtyIndex>
    {
        /// The block number from which the first certification can be issued.
        #[pallet::constant]
        type FirstIssuableOn: Get<frame_system::pallet_prelude::BlockNumberFor<Self>>;

        /// The minimum number of certifications required for membership eligibility.
        #[pallet::constant]
        type MinCertForMembership: Get<u32>;

        /// The minimum number of certifications required to create an identity.
        #[pallet::constant]
        type MinCertForCreateIdtyRight: Get<u32>;

        /// Gallia : si vrai, seuls les Vérificateurs (comptes « Vérificateur Titulus ») peuvent
        /// créer des identités et certifier, et l'adhésion se fait sans règle de distance.
        #[pallet::constant]
        type RestrictToVerifiers: Get<bool>;
    }

    // STORAGE //

    /// Gallia : identités autorisées à créer des identités et à certifier (Vérificateurs Titulus).
    #[pallet::storage]
    pub type Verifiers<T: Config> = StorageMap<_, Twox64Concat, IdtyIndex, (), OptionQuery>;

    /// Gallia : comptes techniques autorisés d'office à recevoir des Gallo (Trésor, comptes de service…),
    /// en plus des comptes des Gallis vérifiés par la Titulus.
    #[pallet::storage]
    pub type AuthorizedAccounts<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, (), OptionQuery>;

    // GENESIS //

    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        /// Gallia : Vérificateurs présents dès le bloc zéro.
        pub verifiers: sp_runtime::Vec<IdtyIndex>,
        /// Gallia : comptes techniques autorisés à recevoir des Gallo dès le bloc zéro.
        pub authorized_accounts: sp_runtime::Vec<T::AccountId>,
        #[serde(skip)]
        pub _phantom: core::marker::PhantomData<T>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            for idty_index in &self.verifiers {
                Verifiers::<T>::insert(idty_index, ());
            }
            for account in &self.authorized_accounts {
                AuthorizedAccounts::<T>::insert(account, ());
            }
        }
    }

    // EVENTS //

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Gallia : un Vérificateur a été ajouté.
        VerifierAdded { idty_index: IdtyIndex },
        /// Gallia : un Vérificateur a été retiré.
        VerifierRemoved { idty_index: IdtyIndex },
        /// Gallia : un compte technique a été autorisé à recevoir des Gallo.
        AccountAuthorized { account: T::AccountId },
        /// Gallia : un compte technique n'est plus autorisé à recevoir des Gallo.
        AccountUnauthorized { account: T::AccountId },
    }

    // CALLS //

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Gallia : ajouter un Vérificateur. Réservé à la gouvernance.
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(1, 1))]
        pub fn add_verifier(origin: OriginFor<T>, idty_index: IdtyIndex) -> DispatchResult {
            ensure_root(origin)?;
            ensure!(
                pallet_identity::Pallet::<T>::identity(idty_index).is_some(),
                Error::<T>::IdtyNotFound
            );
            Verifiers::<T>::insert(idty_index, ());
            Self::deposit_event(Event::VerifierAdded { idty_index });
            Ok(())
        }

        /// Gallia : retirer un Vérificateur. Réservé à la gouvernance.
        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().writes(1))]
        pub fn remove_verifier(origin: OriginFor<T>, idty_index: IdtyIndex) -> DispatchResult {
            ensure_root(origin)?;
            Verifiers::<T>::remove(idty_index);
            Self::deposit_event(Event::VerifierRemoved { idty_index });
            Ok(())
        }

        /// Gallia : faire entrer (ou revenir) une identité certifiée dans la toile, sans règle
        /// de distance. Appelable par le propriétaire de l'identité ou par un Vérificateur.
        #[pallet::call_index(2)]
        #[pallet::weight(Weight::from_parts(1_000_000_000, 20_000).saturating_add(T::DbWeight::get().reads_writes(12, 12)))]
        pub fn claim_membership(origin: OriginFor<T>, idty_index: IdtyIndex) -> DispatchResult {
            let who = ensure_signed(origin)?;
            Self::ensure_owner_or_verifier(&who, idty_index)?;
            pallet_membership::Pallet::<T>::try_add_membership(idty_index)
        }

        /// Gallia : renouveler l'adhésion d'un membre, sans règle de distance.
        /// Appelable par le propriétaire de l'identité ou par un Vérificateur.
        #[pallet::call_index(3)]
        #[pallet::weight(Weight::from_parts(1_000_000_000, 20_000).saturating_add(T::DbWeight::get().reads_writes(8, 8)))]
        pub fn renew_membership(origin: OriginFor<T>, idty_index: IdtyIndex) -> DispatchResult {
            let who = ensure_signed(origin)?;
            Self::ensure_owner_or_verifier(&who, idty_index)?;
            check_renewal_period::<T>(idty_index)?;
            pallet_membership::Pallet::<T>::try_renew_membership(idty_index)
        }

        /// Gallia : autoriser un compte technique à recevoir des Gallo. Réservé à la gouvernance.
        #[pallet::call_index(4)]
        #[pallet::weight(T::DbWeight::get().writes(1))]
        pub fn authorize_account(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
            ensure_root(origin)?;
            AuthorizedAccounts::<T>::insert(&account, ());
            Self::deposit_event(Event::AccountAuthorized { account });
            Ok(())
        }

        /// Gallia : retirer l'autorisation d'un compte technique. Réservé à la gouvernance.
        #[pallet::call_index(5)]
        #[pallet::weight(T::DbWeight::get().writes(1))]
        pub fn unauthorize_account(origin: OriginFor<T>, account: T::AccountId) -> DispatchResult {
            ensure_root(origin)?;
            AuthorizedAccounts::<T>::remove(&account);
            Self::deposit_event(Event::AccountUnauthorized { account });
            Ok(())
        }
    }

    // INTERNAL FUNCTIONS //

    impl<T: Config> Pallet<T> {
        pub(super) fn do_apply_first_issuable_on(idty_index: IdtyIndex) {
            let block_number = frame_system::pallet::Pallet::<T>::block_number();
            pallet_certification::Pallet::<T>::set_next_issuable_on(
                idty_index,
                block_number + T::FirstIssuableOn::get(),
            );
        }

        /// Gallia : vrai si l'identité est un Vérificateur (ou si la restriction est désactivée).
        pub fn is_allowed_issuer(idty_index: IdtyIndex) -> bool {
            !T::RestrictToVerifiers::get() || Verifiers::<T>::contains_key(idty_index)
        }

        /// Gallia : vrai si le compte peut recevoir des Gallo : compte technique autorisé, ou compte
        /// d'un Galli vérifié par la Titulus (identité créée par un Vérificateur, non révoquée).
        pub fn can_receive(who: &T::AccountId) -> bool {
            if !T::RestrictToVerifiers::get() || AuthorizedAccounts::<T>::contains_key(who) {
                return true;
            }
            pallet_identity::Pallet::<T>::identity_index_of(who)
                .and_then(pallet_identity::Pallet::<T>::identity)
                .is_some_and(|idty| idty.status != IdtyStatus::Revoked)
        }

        /// Gallia : erreur `RecipientNotVerified` si le compte ne peut pas recevoir de Gallo.
        pub fn ensure_can_receive(who: &T::AccountId) -> DispatchResult {
            ensure!(Self::can_receive(who), Error::<T>::RecipientNotVerified);
            Ok(())
        }

        /// Gallia : le compte doit posséder l'identité visée, ou celle d'un Vérificateur.
        pub(super) fn ensure_owner_or_verifier(
            who: &T::AccountId,
            idty_index: IdtyIndex,
        ) -> DispatchResult {
            let target =
                pallet_identity::Pallet::<T>::identity(idty_index).ok_or(Error::<T>::IdtyNotFound)?;
            if &target.owner_key == who {
                return Ok(());
            }
            match pallet_identity::Pallet::<T>::identity_index_of(who) {
                Some(caller_idty) if Verifiers::<T>::contains_key(caller_idty) => Ok(()),
                _ => Err(Error::<T>::NotOwnerNorVerifier.into()),
            }
        }
    }

    // ERRORS //

    #[pallet::error]
    pub enum Error<T> {
        /// Insufficient certifications received.
        NotEnoughCerts,
        /// Target status is incompatible with this operation.
        // - Membership can not be added/renewed with this status
        // - Certification can not be added to identity with this status
        TargetStatusInvalid,
        /// Identity creation period not respected.
        IdtyCreationPeriodNotRespected,
        /// Insufficient received certifications to create identity.
        NotEnoughReceivedCertsToCreateIdty,
        /// Maximum number of emitted certifications reached.
        MaxEmittedCertsReached,
        /// Issuer cannot emit a certification because it is not member.
        IssuerNotMember,
        /// Issuer or receiver not found.
        IdtyNotFound,
        /// Membership can only be renewed after an antispam delay.
        MembershipRenewalPeriodNotRespected,
        /// Gallia : seul un Vérificateur Titulus peut créer une identité ou certifier.
        NotAVerifier,
        /// Gallia : seul le propriétaire de l'identité ou un Vérificateur peut faire cela.
        NotOwnerNorVerifier,
        /// Gallia : seuls les Gallis vérifiés par la Titulus et les comptes de la Gallia peuvent recevoir des Gallo.
        RecipientNotVerified,
    }
}

/// Implementing identity call allowance check for the pallet.
impl<AccountId, T: Config> pallet_identity::traits::CheckIdtyCallAllowed<T> for Pallet<T>
where
    T: frame_system::Config<AccountId = AccountId> + pallet_membership::Config,
{
    /// Checks if identity creation is allowed.
    /// This implementation checks the following:
    ///
    /// - Whether the identity has the right to create an identity.
    /// - Whether the issuer can emit a certification.
    /// - Whether the issuer respect creation period.
    fn check_create_identity(creator: IdtyIndex) -> Result<(), DispatchError> {
        // 0. Gallia : seul un Vérificateur crée des identités
        ensure!(Self::is_allowed_issuer(creator), Error::<T>::NotAVerifier);

        let cert_meta = pallet_certification::Pallet::<T>::idty_cert_meta(creator);

        // 1. Check that the identity has the right to create an identity
        // Identity can be a member with 5 certifications and still not reach the identity creation threshold, which could be higher (6, 7...)
        ensure!(
            cert_meta.received_count >= T::MinCertForCreateIdtyRight::get(),
            Error::<T>::NotEnoughReceivedCertsToCreateIdty
        );

        // 2. Check that the issuer can emit one more certification (partial check)
        ensure!(
            cert_meta.issued_count < T::MaxByIssuer::get(),
            Error::<T>::MaxEmittedCertsReached
        );

        // 3. Check that the issuer respects certification creation period
        ensure!(
            cert_meta.next_issuable_on <= frame_system::pallet::Pallet::<T>::block_number(),
            Error::<T>::IdtyCreationPeriodNotRespected
        );
        Ok(())
    }
}

/// Implementing certification allowance check for the pallet.
impl<T: Config> pallet_certification::traits::CheckCertAllowed<IdtyIndex> for Pallet<T> {
    /// Checks if certification is allowed.
    /// This implementation checks the following:
    ///
    /// - Whether the issuer has an identity.
    /// - Whether the issuer's identity is a member.
    /// - Whether the receiver has an identity.
    /// - Whether the receiver's identity is confirmed and not revoked.
    fn check_cert_allowed(issuer: IdtyIndex, receiver: IdtyIndex) -> Result<(), DispatchError> {
        // Issuer checks
        // Ensure issuer is a member
        let issuer_data =
            pallet_identity::Pallet::<T>::identity(issuer).ok_or(Error::<T>::IdtyNotFound)?;
        ensure!(
            issuer_data.status == IdtyStatus::Member,
            Error::<T>::IssuerNotMember
        );
        // Gallia : seul un Vérificateur certifie
        ensure!(Self::is_allowed_issuer(issuer), Error::<T>::NotAVerifier);

        // Receiver checks
        // Ensure receiver identity is confirmed and not revoked
        let receiver_data =
            pallet_identity::Pallet::<T>::identity(receiver).ok_or(Error::<T>::IdtyNotFound)?;
        ensure!(
            receiver_data.status == IdtyStatus::Unvalidated
                || receiver_data.status == IdtyStatus::Member
                || receiver_data.status == IdtyStatus::NotMember,
            Error::<T>::TargetStatusInvalid
        );
        Ok(())
    }
}

/// Implementing membership operation checks for the pallet.
impl<T: Config> sp_membership::traits::CheckMembershipOpAllowed<IdtyIndex> for Pallet<T> {
    /// This implementation checks the following:
    ///
    /// - Whether the identity's status is unvalidated or not a member.
    /// - The count of certifications associated with the identity.
    fn check_add_membership(idty_index: IdtyIndex) -> Result<(), DispatchError> {
        // Check identity status
        let idty_value =
            pallet_identity::Pallet::<T>::identity(idty_index).ok_or(Error::<T>::IdtyNotFound)?;
        ensure!(
            idty_value.status == IdtyStatus::Unvalidated
                || idty_value.status == IdtyStatus::NotMember,
            Error::<T>::TargetStatusInvalid
        );

        // Check certificate count
        check_cert_count::<T>(idty_index)?;
        Ok(())
    }

    /// This implementation checks the following:
    ///
    /// - Whether the identity's status is member.
    ///
    /// Note: There is no need to check certification count since losing certifications makes membership expire.
    /// Membership renewal is only possible when identity is member.
    fn check_renew_membership(idty_index: IdtyIndex) -> Result<(), DispatchError> {
        let idty_value =
            pallet_identity::Pallet::<T>::identity(idty_index).ok_or(Error::<T>::IdtyNotFound)?;
        ensure!(
            idty_value.status == IdtyStatus::Member,
            Error::<T>::TargetStatusInvalid
        );
        Ok(())
    }
}

/// Implementing membership event handling for the pallet.
impl<T: Config> sp_membership::traits::OnNewMembership<IdtyIndex> for Pallet<T>
where
    T: pallet_membership::Config,
{
    /// This implementation notifies the identity pallet when a main membership is acquired.
    /// It is only used on the first membership acquisition.
    fn on_created(idty_index: &IdtyIndex) {
        pallet_identity::Pallet::<T>::membership_added(*idty_index);
    }

    fn on_renewed(_idty_index: &IdtyIndex) {}
}

/// Implementing membership removal event handling for the pallet.
impl<T: Config> sp_membership::traits::OnRemoveMembership<IdtyIndex> for Pallet<T>
where
    T: pallet_membership::Config,
{
    /// This implementation notifies the identity pallet when a main membership is lost.
    fn on_removed(idty_index: &IdtyIndex) -> Weight {
        pallet_identity::Pallet::<T>::membership_removed(*idty_index)
    }
}

/// Implementing the identity event handler for the pallet.
impl<T: Config> pallet_identity::traits::OnNewIdty<T> for Pallet<T> {
    /// This implementation adds a certificate when a new identity is created.
    fn on_created(idty_index: &IdtyIndex, creator: &IdtyIndex) {
        if let Err(_e) =
            <pallet_certification::Pallet<T>>::do_add_cert_checked(*creator, *idty_index, true)
        {
            #[cfg(feature = "std")]
            println!("fail to force add cert: {_e:?}")
        }
    }
}

/// Implementing identity removal event handling for the pallet.
impl<T: Config> pallet_identity::traits::OnRemoveIdty<T> for Pallet<T> {
    /// This implementation removes both membership and certificates associated with the identity.
    fn on_removed(idty_index: &IdtyIndex) -> Weight {
        let mut weight = Self::on_revoked(idty_index);
        weight = weight.saturating_add(
            <pallet_certification::Pallet<T>>::do_remove_all_certs_received_by(*idty_index),
        );
        weight
    }

    /// This implementation removes membership only.
    fn on_revoked(idty_index: &IdtyIndex) -> Weight {
        let mut weight = Weight::zero();
        weight = weight.saturating_add(<pallet_membership::Pallet<T>>::do_remove_membership(
            *idty_index,
            MembershipRemovalReason::Revoked,
        ));
        weight
    }
}

/// Implementing the certification event handler for the pallet.
impl<T: Config> pallet_certification::traits::OnNewcert<IdtyIndex> for Pallet<T> {
    /// This implementation checks if the receiver has received enough certificates to be able to issue certificates,
    /// and applies the first issuable if the condition is met.
    fn on_new_cert(
        _issuer: IdtyIndex,
        _issuer_issued_count: u32,
        receiver: IdtyIndex,
        receiver_received_count: u32,
    ) {
        if receiver_received_count == T::MinReceivedCertToBeAbleToIssueCert::get() {
            Self::do_apply_first_issuable_on(receiver);
        }
    }
}

/// Implementing the certification removal event handler for the pallet.
impl<T: Config> pallet_certification::traits::OnRemovedCert<IdtyIndex> for Pallet<T> {
    /// This implementation checks if the receiver has received fewer certificates than required for membership,
    /// and if so, and the receiver is a member, it expires the receiver's membership.
    fn on_removed_cert(
        _issuer: IdtyIndex,
        _issuer_issued_count: u32,
        receiver: IdtyIndex,
        receiver_received_count: u32,
        _expiration: bool,
    ) {
        if receiver_received_count < T::MinCertForMembership::get()
            && pallet_membership::Pallet::<T>::is_member(&receiver)
        {
            // Expire receiver membership
            <pallet_membership::Pallet<T>>::do_remove_membership(
                receiver,
                MembershipRemovalReason::NotEnoughCerts,
            );
        }
    }
}

/// Implementing the valid distance status event handler for the pallet.
impl<T: Config + pallet_distance::Config> pallet_distance::traits::OnValidDistanceStatus<T>
    for Pallet<T>
{
    /// This implementation handles different scenarios based on the identity's status:
    ///
    /// - For `Unconfirmed` or `Revoked` identities, no action is taken.
    /// - For `Unvalidated` or `NotMember` identities, an attempt is made to add membership.
    /// - For `Member` identities, an attempt is made to renew membership.
    fn on_valid_distance_status(idty_index: IdtyIndex) {
        if let Some(identity) = pallet_identity::Identities::<T>::get(idty_index) {
            match identity.status {
                IdtyStatus::Unconfirmed | IdtyStatus::Revoked => {
                    // IdtyStatus::Unconfirmed
                    // distance evaluation request should never happen for unconfirmed identity
                    // IdtyStatus::Revoked
                    // the identity can have been revoked during distance evaluation by the oracle
                }

                IdtyStatus::Unvalidated | IdtyStatus::NotMember => {
                    // IdtyStatus::Unvalidated
                    // normal scenario for first entry
                    // IdtyStatus::NotMember
                    // normal scenario for re-entry
                    // the following can fail if a certification expired during distance evaluation
                    // otherwise it should succeed
                    let _ = pallet_membership::Pallet::<T>::try_add_membership(idty_index);
                    // sp_std::if_std! {
                    //     if let Err(e) = r {
                    //         print!("failed to claim identity when distance status was found ok: ");
                    //         println!("{:?}", idty_index);
                    //         println!("reason: {:?}", e);
                    //     }
                    // }
                }
                IdtyStatus::Member => {
                    // IdtyStatus::Member
                    // normal scenario for renewal
                    // should succeed
                    let _ = pallet_membership::Pallet::<T>::try_renew_membership(idty_index);
                    // sp_std::if_std! {
                    //     if let Err(e) = r {
                    //         print!("failed to renew identity when distance status was found ok: ");
                    //         println!("{:?}", idty_index);
                    //         println!("reason: {:?}", e);
                    //     }
                    // }
                }
            }
        } else {
            // identity was removed before distance status was found
            // so it's ok to do nothing
            #[cfg(feature = "std")]
            println!("identity was removed before distance status was found: {idty_index:?}");
        }
    }
}

/// Implementing the request distance evaluation check for the pallet.
impl<T: Config + pallet_distance::Config> pallet_distance::traits::CheckRequestDistanceEvaluation<T>
    for Pallet<T>
{
    /// This implementation performs the following checks:
    ///
    /// - Membership renewal anti-spam check: Ensures that membership renewal requests respect the anti-spam period.
    /// - Certificate count check: Ensures that the identity has a sufficient number of certificates.
    fn check_request_distance_evaluation(idty_index: IdtyIndex) -> Result<(), DispatchError> {
        // Check membership renewal anti-spam
        check_renewal_period::<T>(idty_index)?;
        // Check certificate count
        check_cert_count::<T>(idty_index)?;
        Ok(())
    }
}

/// Membership renewal anti-spam: renewal only after `MembershipRenewalPeriod`.
fn check_renewal_period<T: Config>(idty_index: IdtyIndex) -> Result<(), DispatchError> {
    if let Some(membership_data) = pallet_membership::Pallet::<T>::membership(idty_index) {
        // If membership data exists, this is for a renewal, apply anti-spam
        ensure!(
            // current_block > expiration block - membership period + renewal period
            membership_data.expire_on
                + <T as pallet_membership::Config>::MembershipRenewalPeriod::get()
                < frame_system::Pallet::<T>::block_number()
                    + <T as pallet_membership::Config>::MembershipPeriod::get(),
            Error::<T>::MembershipRenewalPeriodNotRespected
        );
    }
    Ok(())
}

/// Checks the certificate count for an identity.
fn check_cert_count<T: Config>(idty_index: IdtyIndex) -> Result<(), DispatchError> {
    let idty_cert_meta = pallet_certification::Pallet::<T>::idty_cert_meta(idty_index);
    ensure!(
        idty_cert_meta.received_count >= T::MinCertForMembership::get(),
        Error::<T>::NotEnoughCerts
    );
    Ok(())
}
