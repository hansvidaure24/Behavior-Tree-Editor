#pragma once
#include "BTNode.h"

UCLASS()
class UInvertNode : public UBTNode
{
	GENERATED_BODY()
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		if (Children.Num() == 0) return EBTNodeStatus::Failure;
		EBTNodeStatus Status = Children[0]->Tick(Bb);
		if (Status == EBTNodeStatus::Success) return EBTNodeStatus::Failure;
		if (Status == EBTNodeStatus::Failure) return EBTNodeStatus::Success;
		return Status;
	}
};
